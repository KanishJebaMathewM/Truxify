"""Real SQLite, signed local artifacts and native reader/writer interleavings."""

import importlib
import pickle
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from threading import Barrier, Event, get_ident

import pytest
from app.models import base
from app.models.demand_forecast import MODEL_NAME
from app.models.generation_rollback import RollbackRecoveryError
from services.ab_rollback import RollbackOutcomeUnknown
from services.ab_testing import ABTestModel
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError, OperationalError


@pytest.fixture
def pair(tmp_path, monkeypatch):
    monkeypatch.setattr(base, "MODEL_STORAGE_DIR", str(tmp_path / "models"))
    monkeypatch.setattr(base, "MODEL_ARTIFACT_SIGNATURE_DIR", str(tmp_path / "signatures"))
    monkeypatch.setenv("MODEL_ARTIFACT_HMAC_KEY", "isolated-local-test-fixture-only")
    path = f"sqlite:///{tmp_path / 'ledger.db'}"
    a = base.publish_model({"label": "A"}, MODEL_NAME)
    service = ABTestModel(path)
    service.log_metrics("test", a, {"mae": 10}, "production")
    b = base.publish_model({"label": "B"}, MODEL_NAME)
    service.log_metrics("test", b, {"mae": 30}, "shadow")
    yield service, a, b, path
    service.engine.dispose()


def assert_model(generation, previous, label):
    assert base.get_active_generation(MODEL_NAME) == generation
    assert base.get_previous_generation(MODEL_NAME) == previous
    snapshot = base.load_model_snapshot(MODEL_NAME)
    assert snapshot.generation == generation
    assert snapshot.model == {"label": label}
    assert snapshot.metadata["generation"] == generation
    flat = base.get_model_path(MODEL_NAME)
    assert base._verify_artifact(flat)
    with open(flat, "rb") as source:
        assert pickle.load(source) == {"label": label}


def test_concurrent_services_and_restart_roll_back_once(pair):
    service, a, b, path = pair
    second = ABTestModel(path)
    gate = Barrier(2)

    def request(instance):
        gate.wait(timeout=5)
        return instance.trigger_rollback("test")

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(request, (service, second)))
    assert sorted(result["action"] for result in results) == ["none", "rollback"]
    assert next(r for r in results if r["action"] == "rollback")["production_version"] == a
    assert_model(a, b, "A")
    restarted = ABTestModel(path)
    assert restarted.trigger_rollback("test")["action"] == "none"
    assert not restarted.log_metrics("test", b, {"mae": 100}, "late")
    assert_model(a, b, "A")


def test_stale_experiment_cannot_replace_newer_publication(pair):
    service, _, b, _ = pair
    c = base.publish_model({"label": "C"}, MODEL_NAME)
    assert service.trigger_rollback("test")["action"] == "rollback_failed"
    assert_model(c, b, "C")
    assert service.ledger.read("test")["status"] == "rollback_failed"


def test_two_experiments_bound_to_same_pair_cannot_swap_twice(pair):
    service, a, b, _ = pair
    service.get_production_version = lambda: a
    service.ledger.production_version = service.get_production_version
    service.log_metrics("other", a, {"mae": 10}, "production")
    service.log_metrics("other", b, {"mae": 30}, "shadow")
    assert service.trigger_rollback("test")["rolled_back"]
    assert not service.trigger_rollback("other")["rolled_back"]
    assert_model(a, b, "A")


def reject_terminal(service):
    with service.engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_terminal BEFORE UPDATE OF status ON ab_experiments "
            "WHEN NEW.status='rolled_back' BEGIN SELECT RAISE(ABORT,'native rejection'); END"
        )


def test_native_sql_rejection_recovers_model_and_allows_retry(pair):
    service, a, b, _ = pair
    reject_terminal(service)
    with pytest.raises(IntegrityError):
        service.trigger_rollback("test")
    assert_model(b, a, "B")
    assert service.ledger.read("test")["status"] == "active"
    with service.Session() as session:
        assert set(session.scalars(select(service.ledger.Metric.status))) == {"active"}
    with service.engine.begin() as connection:
        connection.exec_driver_sql("DROP TRIGGER reject_terminal")
    assert service.trigger_rollback("test")["rolled_back"]
    assert_model(a, b, "A")


@pytest.mark.parametrize("method", ["_atomic_write_json", "_mirror_to_flat", "_sign_artifact"])
@pytest.mark.parametrize("after", [False, True])
def test_one_shot_storage_failure_recovers_exact_signed_pair(pair, monkeypatch, method, after):
    service, a, b, _ = pair
    native = getattr(base, method)
    called = False

    def fail_once(*args, **kwargs):
        nonlocal called
        if not called:
            called = True
            if after:
                native(*args, **kwargs)
            raise OSError("controlled local storage failure")
        return native(*args, **kwargs)

    monkeypatch.setattr(base, method, fail_once)
    result = service.trigger_rollback("test")
    assert called
    assert result["action"] == "rollback_failed"
    assert not result["rolled_back"]
    assert_model(b, a, "B")
    assert service.ledger.read("test")["status"] == "rollback_failed"


@pytest.mark.parametrize("committed", [False, True])
def test_commit_acknowledgement_is_reconciled_against_native_receipt(pair, monkeypatch, committed):
    service, a, b, _ = pair
    native = service.ledger.transaction

    @contextmanager
    def interrupted():
        if committed:
            with native() as session:
                yield session
            raise OSError("acknowledgement lost after commit")
        with native() as session:
            yield session
            raise OSError("failure before commit")

    monkeypatch.setattr(service.ledger, "transaction", interrupted)
    if committed:
        assert service.trigger_rollback("test")["rolled_back"]
        assert_model(a, b, "A")
    else:
        with pytest.raises(OSError):
            service.trigger_rollback("test")
        assert_model(b, a, "B")
    monkeypatch.setattr(service.ledger, "transaction", native)
    assert service.ledger.read("test")["status"] == ("rolled_back" if committed else "active")


def test_unreadable_commit_outcome_never_claims_success_or_guesses_compensation(pair, monkeypatch):
    service, a, b, _ = pair
    native = service.ledger.transaction
    native_session = service.Session

    @contextmanager
    def interrupted():
        with native() as session:
            yield session
        raise OSError("acknowledgement lost")

    def unavailable():
        raise OperationalError("read unavailable", {}, None)

    monkeypatch.setattr(service.ledger, "transaction", interrupted)
    monkeypatch.setattr(service, "Session", unavailable)
    with pytest.raises(RollbackOutcomeUnknown):
        service.trigger_rollback("test")
    assert_model(a, b, "A")
    monkeypatch.setattr(service, "Session", native_session)
    monkeypatch.setattr(service.ledger, "transaction", native)
    assert service.trigger_rollback("test")["action"] == "none"


def test_native_readers_and_publishers_wait_through_failed_ledger_recovery(pair, monkeypatch):
    service, _a, b, _ = pair
    entered, release = Event(), Event()
    native = base._mirror_to_flat
    paused = False

    def pause_once(*args):
        nonlocal paused
        native(*args)
        if not paused:
            paused = True
            entered.set()
            assert release.wait(5)

    monkeypatch.setattr(base, "_mirror_to_flat", pause_once)
    reject_terminal(service)
    with ThreadPoolExecutor(3) as pool:
        rollback = pool.submit(service.trigger_rollback, "test")
        assert entered.wait(5)
        reader = pool.submit(base.load_model_snapshot, MODEL_NAME)
        publisher = pool.submit(base.publish_model, {"label": "C"}, MODEL_NAME)
        assert not reader.done()
        assert not publisher.done()
        release.set()
        with pytest.raises(IntegrityError):
            rollback.result(timeout=5)
        snapshot = reader.result(timeout=5)
        c = publisher.result(timeout=5)
    assert snapshot.model["label"] in {"B", "C"}
    assert snapshot.generation in {b, c}
    assert snapshot.metadata["generation"] == snapshot.generation
    assert_model(c, b, "C")
    assert service.ledger.read("test")["status"] == "active"


@pytest.mark.parametrize("target", ["active", "previous"])
def test_missing_or_invalid_native_artifact_never_changes_pointers(pair, target):
    service, a, b, _ = pair
    generation = b if target == "active" else a
    with open(base._generation_model_path(MODEL_NAME, generation), "ab") as source:
        source.write(b"invalid local fixture")
    assert service.trigger_rollback("test")["action"] == "rollback_failed"
    assert base.get_active_generation(MODEL_NAME) == b
    assert base.get_previous_generation(MODEL_NAME) == a


def test_unrecoverable_storage_failure_is_explicit_and_never_terminal_success(pair, monkeypatch):
    service, _, _, _ = pair

    def unavailable(*args):
        raise OSError("persistent native storage failure")

    monkeypatch.setattr(base, "_mirror_to_flat", unavailable)
    with pytest.raises(RollbackRecoveryError):
        service.trigger_rollback("test")
    assert service.ledger.read("test")["status"] == "active"


def test_actual_rollback_route_runs_native_transaction_on_worker(pair, monkeypatch, tmp_path):
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    service, a, b, _ = pair
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'route.db'}")
    routes = importlib.import_module("routes.ab_testing")
    monkeypatch.setattr(routes, "ab_service", service)
    app = FastAPI()
    app.include_router(routes.router)
    loop_threads, worker_threads = [], []
    native = service.trigger_rollback

    @app.middleware("http")
    async def record_loop(request, call_next):
        loop_threads.append(get_ident())
        return await call_next(request)

    def record_worker(test_id):
        worker_threads.append(get_ident())
        return native(test_id)

    monkeypatch.setattr(service, "trigger_rollback", record_worker)
    with TestClient(app) as client:
        response = client.post("/ab-testing/rollback/test")
        assert response.status_code == 200
        assert response.json()["production_version"] == a
        assert response.json()["rolled_back"]
        assert client.post("/ab-testing/rollback/test").json()["action"] == "none"
    assert set(loop_threads).isdisjoint(worker_threads)
    assert_model(a, b, "A")
