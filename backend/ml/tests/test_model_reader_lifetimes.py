"""Real model files and deterministic native-reader/publication interleavings."""

import json
import os
import threading
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path

import pytest
from app.models import base


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "store"))
    monkeypatch.setattr(
        base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures")
    )
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "local-reader-test-fixture")
    yield tmp_path
    assert base._generation_readers.get("demo", {}) == {}
    assert "demo" not in base._deleted_reader_models


def publish(version):
    base.save_model({"version": version}, "demo", {"version": version})
    return base.get_active_generation("demo")


def path(generation):
    return Path(base._generation_dir("demo", generation))


def paused_reader(monkeypatch, entered, release):
    original = base._verify_artifact

    def verify(model_path):
        valid = original(model_path)
        if threading.current_thread().name.startswith("reader"):
            entered.set()
            assert release.wait(3)
        return valid

    monkeypatch.setattr(base, "_verify_artifact", verify)


def test_two_publications_do_not_delete_an_admitted_model_and_metadata(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model_snapshot, "demo")
        try:
            assert entered.wait(1)
            publish(2)
            publish(3)
            assert path(first).exists()
        finally:
            release.set()
        snapshot = reader.result(timeout=1)
    assert snapshot.model == {"version": 1}
    assert snapshot.metadata["metrics"] == {"version": 1}
    assert snapshot.generation == snapshot.metadata["generation"] == first
    assert not path(first).exists()
    assert base.load_model("demo") == {"version": 3}


def test_retained_generations_are_bounded_to_live_reservations(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model, "demo")
        try:
            assert entered.wait(1)
            for version in range(2, 22):
                publish(version)
                assert len(list(Path(base._generations_root("demo")).iterdir())) <= 3
            assert path(first).exists()
        finally:
            release.set()
        assert reader.result(timeout=1) == {"version": 1}
    assert len(list(Path(base._generations_root("demo")).iterdir())) == 2


def test_multiple_readers_release_only_their_own_reservation(monkeypatch):
    first = publish(1)
    entered = [threading.Event(), threading.Event()]
    releases = [threading.Event(), threading.Event()]
    original = base._verify_artifact
    counter, guard = 0, threading.Lock()

    def verify(model_path):
        nonlocal counter
        valid = original(model_path)
        if threading.current_thread().name.startswith("reader"):
            with guard:
                index = counter
                counter += 1
            entered[index].set()
            assert releases[index].wait(3)
        return valid

    monkeypatch.setattr(base, "_verify_artifact", verify)
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="reader") as pool:
        a = pool.submit(base.load_model, "demo")
        assert entered[0].wait(1)
        b = pool.submit(base.load_model, "demo")
        try:
            assert entered[1].wait(1)
            publish(2)
            publish(3)
            releases[0].set()
            assert a.result(timeout=1) == {"version": 1}
            assert path(first).exists()
            assert base._generation_readers["demo"][first] == 1
        finally:
            for release in releases:
                release.set()
        assert b.result(timeout=1) == {"version": 1}
    assert not path(first).exists()


def test_delete_hides_new_reads_but_allows_admitted_reader_to_finish(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model_snapshot, "demo")
        try:
            assert entered.wait(1)
            base.delete_model("demo")
            assert path(first).exists()
            assert base.load_model("demo") is None
            assert base.get_model_meta("demo") is None
            assert base.get_generation_meta("demo", first) is None
            assert base.model_exists("demo") is False
        finally:
            release.set()
        assert reader.result(timeout=1).model == {"version": 1}
    assert not path(first).exists()
    publish(2)
    assert base.load_model("demo") == {"version": 2}


def test_new_publication_after_delete_does_not_reclaim_old_reader(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model_snapshot, "demo")
        try:
            assert entered.wait(1)
            base.delete_model("demo")
            publish(2)
            assert path(first).exists()
        finally:
            release.set()
        assert reader.result(timeout=1).model == {"version": 1}
    assert base.load_model("demo") == {"version": 2}
    assert not path(first).exists()


def test_rollback_does_not_change_an_admitted_snapshot(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model_snapshot, "demo")
        try:
            assert entered.wait(1)
            publish(2)
            publish(3)
            assert base.restore_previous_model("demo")
            assert base.get_model_meta("demo")["metrics"]["version"] == 2
        finally:
            release.set()
        assert reader.result(timeout=1).generation == first
    assert base.load_model("demo") == {"version": 2}


def test_exceptional_reader_exit_releases_generation(monkeypatch):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    paused_reader(monkeypatch, entered, release)
    original = base.pickle.load

    def fail(file):
        if threading.current_thread().name.startswith("reader"):
            raise RuntimeError("reader deserialization failed")
        return original(file)

    monkeypatch.setattr(base.pickle, "load", fail)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = pool.submit(base.load_model, "demo")
        try:
            assert entered.wait(1)
            publish(2)
            publish(3)
        finally:
            release.set()
        with pytest.raises(RuntimeError, match="deserialization"):
            reader.result(timeout=1)
    assert not path(first).exists()
    assert base.load_model("demo") == {"version": 3}


@pytest.mark.parametrize("explicit", [True, False])
def test_metadata_read_has_the_same_lifetime_contract(monkeypatch, explicit):
    first = publish(1)
    entered, release = threading.Event(), threading.Event()
    original = base._read_candidate_meta

    def read(*args):
        if threading.current_thread().name.startswith("reader"):
            entered.set()
            assert release.wait(3)
        return original(*args)

    monkeypatch.setattr(base, "_read_candidate_meta", read)
    with ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as pool:
        reader = (
            pool.submit(base.get_generation_meta, "demo", first)
            if explicit
            else pool.submit(base.get_model_meta, "demo")
        )
        try:
            assert entered.wait(1)
            publish(2)
            publish(3)
        finally:
            release.set()
        assert reader.result(timeout=1)["generation"] == first
    assert not path(first).exists()


def test_mutable_legacy_read_serializes_with_publication(monkeypatch):
    publish(1)
    os.remove(base._active_ptr_path("demo"))
    entered, release, writer_entered = (
        threading.Event(),
        threading.Event(),
        threading.Event(),
    )
    paused_reader(monkeypatch, entered, release)
    with (
        ThreadPoolExecutor(max_workers=1, thread_name_prefix="reader") as readers,
        ThreadPoolExecutor(max_workers=1) as writers,
    ):
        reader = readers.submit(base.load_model_snapshot, "demo")
        assert entered.wait(1)

        def write():
            writer_entered.set()
            return publish(2)

        writer = writers.submit(write)
        try:
            assert writer_entered.wait(1)
            with pytest.raises(FutureTimeout):
                writer.result(timeout=0.05)
        finally:
            release.set()
        snapshot = reader.result(timeout=1)
        writer.result(timeout=1)
    assert snapshot.model == {"version": 1}
    assert snapshot.metadata["metrics"]["version"] == 1
    assert base.load_model("demo") == {"version": 2}


def test_missing_or_mismatched_metadata_is_not_attached_to_model():
    generation = publish(1)
    metadata = Path(base._generation_meta_path("demo", generation))
    meta = json.loads(metadata.read_text())
    meta["generation"] = "different"
    metadata.write_text(json.dumps(meta))
    snapshot = base.load_model_snapshot("demo")
    assert snapshot.model == {"version": 1}
    assert snapshot.metadata is None
    metadata.unlink()
    assert base.load_model_snapshot("demo").metadata is None


def test_missing_generation_between_selection_and_admission_recovers(monkeypatch):
    first = publish(1)
    original = base._reader_candidates

    def candidates(name):
        result = original(name)
        publish(2)
        publish(3)
        return result

    monkeypatch.setattr(base, "_reader_candidates", candidates)
    assert base.load_model("demo") == {"version": 3}
    assert not path(first).exists()


def test_invalid_active_artifact_falls_back_without_leaking_a_reservation():
    first = publish(1)
    second = publish(2)
    with (path(second) / "model.pkl").open("ab") as artifact:
        artifact.write(b"changed")
    snapshot = base.load_model_snapshot("demo")
    assert snapshot.model == {"version": 1}
    assert snapshot.generation == first
    assert snapshot.metadata["generation"] == first
    assert base._generation_readers.get("demo", {}) == {}


def test_unsigned_generation_and_mirror_are_not_deserialized(monkeypatch):
    generation = publish(1)
    for artifact in (str(path(generation) / "model.pkl"), base.get_model_path("demo")):
        Path(base._artifact_signature_path(artifact)).unlink()

    def unexpected_load(_):
        pytest.fail("invalid artifact reached deserialization")

    monkeypatch.setattr(base.pickle, "load", unexpected_load)
    assert base.load_model_snapshot("demo") is None
    assert base._generation_readers.get("demo", {}) == {}
