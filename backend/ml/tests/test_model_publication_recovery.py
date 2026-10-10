"""Ordinary-failure native filesystem publication and ownership controls."""

import pickle
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FutureTimeout
from pathlib import Path
from threading import Event

import numpy as np
import pytest
from app.execution import TrainingCancelled
from app.models import base
from app.models.generation_publication import PublicationRecoveryError
from sklearn.linear_model import LinearRegression


@pytest.fixture(autouse=True)
def store(tmp_path, monkeypatch):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "models"))
    monkeypatch.setattr(base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures"))
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "isolated-native-publication-fixture")


def files(name):
    flat = base.get_model_path(name)
    return [base._active_ptr_path(name), base._previous_ptr_path(name), flat,
            base.get_meta_path(name), base._artifact_signature_path(flat)]


def snapshot(name):
    return {path: Path(path).read_bytes() if Path(path).exists() else None
            for path in files(name)}


def assert_exact(before):
    for path, contents in before.items():
        assert (Path(path).read_bytes() if Path(path).exists() else None) == contents


def publish(version, name="demo"):
    return base.publish_model({"version": version}, name, {"version": version})


def inject_once(monkeypatch, method, after, name="demo"):
    native = getattr(base, method)
    failed = False

    def fail(*args, **kwargs):
        nonlocal failed
        relevant = method != "_sign_artifact" or args[0] == base.get_model_path(name)
        if not failed and relevant:
            failed = True
            if after:
                native(*args, **kwargs)
            raise OSError("controlled local publication failure")
        return native(*args, **kwargs)

    monkeypatch.setattr(base, method, fail)
    return native


@pytest.mark.parametrize("method", ["_atomic_write_json", "_mirror_to_flat", "_sign_artifact"])
@pytest.mark.parametrize("after", [False, True])
@pytest.mark.parametrize("initial", ["empty", "legacy", "generations"])
def test_before_after_native_failure_restores_exact_store_and_retry(monkeypatch, method, after, initial):
    if initial != "empty":
        publish("A")
        publish("B")
    if initial == "legacy":
        Path(base._active_ptr_path("demo")).unlink()
        Path(base._previous_ptr_path("demo")).unlink()
    before = snapshot("demo")
    native = inject_once(monkeypatch, method, after)
    with pytest.raises(OSError):
        publish("C")
    assert_exact(before)
    if initial == "empty":
        assert not base.model_exists("demo")
        assert base.load_model_snapshot("demo") is None
    else:
        assert base.load_model("demo") == {"version": "B"}
        assert base._verify_artifact(base.get_model_path("demo"))
    assert not list(Path(base.MODEL_STORAGE_DIR).rglob("*.tmp"))
    monkeypatch.setattr(base, method, native)
    c = publish("C")
    assert base.get_active_generation("demo") == c
    assert base.load_model("demo") == {"version": "C"}


def test_failed_active_pointer_after_write_preserves_two_generation_history(monkeypatch):
    a, b = publish("A"), publish("B")
    before = snapshot("demo")
    native = base._atomic_write_json

    def fail_active(path, data):
        native(path, data)
        if path == base._active_ptr_path("demo"):
            raise OSError("active pointer acknowledgement failed")

    monkeypatch.setattr(base, "_atomic_write_json", fail_active)
    with pytest.raises(OSError):
        publish("C")
    assert_exact(before)
    assert base.get_active_generation("demo") == b
    assert base.get_previous_generation("demo") == a
    monkeypatch.setattr(base, "_atomic_write_json", native)
    assert base.restore_previous_model("demo")
    assert base.load_model("demo") == {"version": "A"}


def test_committed_publication_remains_success_when_reclamation_fails(monkeypatch):
    publish("A")
    b = publish("B")

    def unavailable(*args):
        raise OSError("cleanup unavailable")

    monkeypatch.setattr(base, "_prune_generations", unavailable)
    c = publish("C")
    assert base.get_active_generation("demo") == c
    assert base.get_previous_generation("demo") == b
    assert base._verify_artifact(base.get_model_path("demo"))
    with open(base.get_model_path("demo"), "rb") as source:
        assert pickle.load(source) == {"version": "C"}


def test_native_readers_and_later_writer_wait_through_recovery(monkeypatch):
    publish("A")
    b = publish("B")
    entered, release, reader_started, writer_started = (Event() for _ in range(4))
    native = base._mirror_to_flat
    failed = False

    def fail_once(*args):
        nonlocal failed
        native(*args)
        if not failed:
            failed = True
            entered.set()
            assert release.wait(10)
            raise OSError("publication rejected after mirror")

    def read():
        reader_started.set()
        return base.load_model_snapshot("demo")

    def later():
        writer_started.set()
        return publish("D")

    monkeypatch.setattr(base, "_mirror_to_flat", fail_once)
    with ThreadPoolExecutor(3) as pool:
        failed_save = pool.submit(publish, "C")
        assert entered.wait(10)
        reader, writer = pool.submit(read), pool.submit(later)
        try:
            assert reader_started.wait(10) and writer_started.wait(10)
            for future in (reader, writer):
                with pytest.raises(FutureTimeout):
                    future.result(timeout=0.05)
            # Another model has an independent owner and can progress.
            assert publish("other", "independent")
        finally:
            release.set()
        with pytest.raises(OSError):
            failed_save.result(timeout=10)
        observed, d = reader.result(timeout=10), writer.result(timeout=10)
    assert observed.generation in {b, d}
    assert observed.model["version"] in {"B", "D"}
    assert observed.metadata["generation"] == observed.generation
    assert base.get_previous_generation("demo") == b


def test_real_fitted_model_and_metadata_remain_paired_after_failed_save(monkeypatch):
    x = np.arange(6, dtype=float).reshape(-1, 1)
    original = LinearRegression().fit(x, x[:, 0] * 2)
    candidate = LinearRegression().fit(x, x[:, 0] * 9)
    a = base.publish_model(original, "demo", {"slope": 2})
    inject_once(monkeypatch, "_mirror_to_flat", True)
    with pytest.raises(OSError):
        base.publish_model(candidate, "demo", {"slope": 9})
    observed = base.load_model_snapshot("demo")
    assert observed.generation == a
    assert observed.metadata["metrics"] == {"slope": 2}
    np.testing.assert_allclose(observed.model.predict(x), x[:, 0] * 2)


def test_snapshot_preparation_failure_never_starts_publication(monkeypatch):
    from app.models import generation_publication

    publish("A")
    publish("B")
    before = snapshot("demo")

    def no_space(*args):
        raise OSError("snapshot storage unavailable")

    monkeypatch.setattr(generation_publication.shutil, "copyfile", no_space)
    with pytest.raises(OSError):
        publish("C")
    assert_exact(before)
    assert not list(Path(base.MODEL_STORAGE_DIR).rglob("*.tmp"))


def test_recovery_failure_preserves_backups_and_reports_unknown_store(monkeypatch):
    from app.models import generation_publication

    publish("A")
    publish("B")
    native = generation_publication.shutil.copyfile
    copies = 0

    def fail_recovery(*args):
        nonlocal copies
        copies += 1
        if copies > 5:
            raise OSError("recovery storage unavailable")
        return native(*args)

    monkeypatch.setattr(generation_publication.shutil, "copyfile", fail_recovery)
    inject_once(monkeypatch, "_mirror_to_flat", True)
    with pytest.raises(PublicationRecoveryError):
        publish("C")
    assert list(Path(base.MODEL_STORAGE_DIR).rglob("*.tmp"))


def test_failed_republication_preserves_deleted_reader_tombstone(monkeypatch):
    a = publish("A")
    path = base._generation_model_path("demo", a)
    with base._candidate_lease("demo", path) as admitted:
        assert admitted
        base.delete_model("demo")
        assert "demo" in base._deleted_reader_models
        before = snapshot("demo")
        inject_once(monkeypatch, "_mirror_to_flat", True)
        with pytest.raises(OSError):
            publish("C")
        assert_exact(before)
        assert "demo" in base._deleted_reader_models
        assert base.load_model_snapshot("demo") is None
        assert Path(path).exists()
    assert not Path(path).exists()


def test_cancellation_during_snapshot_copy_does_not_publish(monkeypatch):
    from app.models import generation_publication

    publish("A")
    publish("B")
    before = snapshot("demo")
    native = generation_publication.shutil.copyfile
    cancelled = False

    def copy_then_cancel(*args):
        nonlocal cancelled
        result = native(*args)
        cancelled = True
        return result

    monkeypatch.setattr(generation_publication.shutil, "copyfile", copy_then_cancel)
    monkeypatch.setattr(base, "_training_cancelled", lambda: cancelled)
    with pytest.raises(TrainingCancelled):
        publish("C")
    assert_exact(before)
    assert not list(Path(base.MODEL_STORAGE_DIR).rglob("*.tmp"))
