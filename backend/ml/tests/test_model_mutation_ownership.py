"""Native filesystem mutation outcomes and exact maintenance ownership."""

import json
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
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "isolated-mutation-test-fixture")
    return tmp_path


def publish(version, name="demo"):
    return base.publish_model({"version": version}, name, {"version": version})


def test_publication_returns_its_owned_generation_while_another_writer_waits(
    monkeypatch,
):
    entered, release, started = threading.Event(), threading.Event(), threading.Event()
    native_save = base.save_model

    def paused_save(*args, **kwargs):
        native_save(*args, **kwargs)
        entered.set()
        assert release.wait(10)

    monkeypatch.setattr(base, "save_model", paused_save)

    def next_writer():
        started.set()
        native_save({"version": 2}, "demo", {"version": 2})

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(publish, 1)
        try:
            assert entered.wait(10)
            owned = base.get_active_generation("demo")
            later = pool.submit(next_writer)
            assert started.wait(10)
            with pytest.raises(FutureTimeout):
                later.result(timeout=0.05)
        finally:
            release.set()
        receipt = first.result(timeout=10)
        later.result(timeout=10)
    assert receipt == owned
    assert receipt != base.get_active_generation("demo")
    assert base.get_generation_meta("demo", receipt)["metrics"] == {"version": 1}
    assert base.load_model("demo") == {"version": 2}


def test_rollback_receipt_keeps_restored_generation_and_metrics(monkeypatch):
    original = publish(1)
    publish(2)
    entered, release, started = threading.Event(), threading.Event(), threading.Event()
    native_restore = base.restore_previous_model

    def paused_restore(*args, **kwargs):
        result = native_restore(*args, **kwargs)
        entered.set()
        assert release.wait(10)
        return result

    monkeypatch.setattr(base, "restore_previous_model", paused_restore)

    def next_writer():
        started.set()
        return publish(3)

    with ThreadPoolExecutor(max_workers=2) as pool:
        rollback = pool.submit(base.rollback_model, "demo")
        try:
            assert entered.wait(10)
            later = pool.submit(next_writer)
            assert started.wait(10)
            with pytest.raises(FutureTimeout):
                later.result(timeout=0.05)
        finally:
            release.set()
        result = rollback.result(timeout=10)
        later.result(timeout=10)
    assert result["rolled_back"] is True
    assert result["active_generation"] == original
    assert result["metrics"] == {"version": 1}
    assert base.load_model("demo") == {"version": 3}


@pytest.mark.parametrize("all_models", [False, True])
def test_native_open_serialization_survives_concurrent_cleanup(all_models):
    entered, release, started = threading.Event(), threading.Event(), threading.Event()

    class PausedModel:
        def __reduce__(self):
            entered.set()
            assert release.wait(10)
            return dict, ({"version": 4},)

    def cleanup():
        started.set()
        base.cleanup_stale_training_artifacts(None if all_models else "demo")

    with ThreadPoolExecutor(max_workers=2) as pool:
        writer = pool.submit(base.save_model, PausedModel(), "demo", {"version": 4})
        try:
            assert entered.wait(10)
            generation_root = Path(base._generations_root("demo"))
            active_temps = list(generation_root.rglob("*.tmp"))
            assert len(active_temps) == 1
            maintenance = pool.submit(cleanup)
            assert started.wait(10)
            with pytest.raises(FutureTimeout):
                maintenance.result(timeout=0.05)
            assert active_temps[0].exists()
        finally:
            release.set()
        assert writer.result(timeout=10) is None
        maintenance.result(timeout=10)
    assert base.load_model("demo") == {"version": 4}
    assert list(generation_root.rglob("*.tmp")) == []


def test_separate_model_publication_progresses_during_owned_save(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    native_save = base.save_model

    def paused_save(model, name, *args, **kwargs):
        native_save(model, name, *args, **kwargs)
        if name == "demo":
            entered.set()
            assert release.wait(10)

    monkeypatch.setattr(base, "save_model", paused_save)
    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(publish, 1)
        try:
            assert entered.wait(10)
            second = pool.submit(publish, 2, "other")
            assert second.result(timeout=3) == base.get_active_generation("other")
        finally:
            release.set()
        first.result(timeout=10)
    assert base.load_model("other") == {"version": 2}


def test_backup_metadata_identifies_backup_and_preserves_source_provenance():
    source = publish(1)
    backup = base.backup_model("demo")
    assert backup != source
    meta = base.get_generation_meta("demo", backup)
    assert meta["generation"] == backup
    assert meta["backup_from_generation"] == source
    assert meta["metrics"] == {"version": 1}
    assert base.restore_previous_model("demo") is True
    snapshot = base.load_model_snapshot("demo")
    assert snapshot.generation == snapshot.metadata["generation"] == backup
    assert snapshot.model == {"version": 1}


def test_legacy_backup_becomes_a_matched_generation():
    Path(base.get_model_path("demo")).write_bytes(
        __import__("pickle").dumps({"version": 5})
    )
    Path(base.get_meta_path("demo")).write_text(
        json.dumps({"model_name": "demo", "metrics": {"version": 5}})
    )
    backup = base.backup_model("demo")
    meta = base.get_generation_meta("demo", backup)
    assert meta["generation"] == backup
    assert meta["backup_from_generation"] == base.get_active_generation("demo")
    assert base.restore_previous_model("demo")
    assert base.load_model_snapshot("demo").metadata["metrics"] == {"version": 5}


def test_missing_previous_rollback_keeps_consistent_current_outcome():
    generation = publish(1)
    result = base.rollback_model("demo")
    assert result["rolled_back"] is False and result["active_generation"] == generation
    assert result["metrics"] == {"version": 1}


def test_exact_cleanup_removes_native_owned_temps_without_prefix_collisions():
    generation = publish(1)
    root = Path(base.MODEL_STORAGE_DIR)
    gen = Path(base._generation_dir("demo", generation))
    uuid = "a" * 32
    owned = [
        root / f"demo.pkl.{uuid}.tmp",
        root / f"demo_meta.json.{uuid}.tmp",
        root / f"demo_active.json.{uuid}.tmp",
        root / f"demo_previous_active.json.{uuid}.tmp",
        gen / f"model.pkl.{uuid}.tmp",
        gen / f"meta.json.{uuid}.tmp",
    ]
    foreign = [
        root / f"demo_extra.pkl.{uuid}.tmp",
        root / f"demo.notes.{uuid}.tmp",
        root / "demo.pkl.notes.tmp",
        gen / "notes.tmp",
        gen / f"other.pkl.{uuid}.tmp",
    ]
    for path in owned + foreign:
        path.write_text("private scratch")
    directory = root / f"demo.pkl.{'b' * 32}.tmp"
    directory.mkdir()
    base.cleanup_stale_training_artifacts("demo")
    assert all(not p.exists() for p in owned)
    assert all(p.exists() for p in foreign)
    assert directory.is_dir()
    assert base.load_model("demo") == {"version": 1}
    assert base.get_model_meta("demo")["generation"] == generation


def test_cleanup_without_storage_or_registered_models_is_safe():
    base.cleanup_stale_training_artifacts()
    base.cleanup_stale_training_artifacts("missing")
    assert not base.model_exists("missing")
