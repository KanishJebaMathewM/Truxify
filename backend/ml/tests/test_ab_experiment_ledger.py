"""Native SQLite invariant tests; only the external generation read is controlled."""

import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from threading import Barrier

import pytest
from services.ab_testing import ABTestMetrics, ABTestModel
from sqlalchemy import func, select


def service(path, generation="gen-original"):
    instance = ABTestModel(f"sqlite:///{path}")
    instance.get_production_version = lambda: generation
    return instance


def rows(instance):
    with instance.Session() as session:
        return session.scalar(select(func.count()).select_from(ABTestMetrics))


def pair(instance, test_id="test"):
    instance.log_metrics(test_id, "gen-original", {"mae": 10.0}, "prod")
    instance.log_metrics(test_id, "gen-candidate", {"mae": 30.0}, "shadow")


def test_restart_freezes_original_pair_despite_current_generation(tmp_path):
    path = tmp_path / "experiment.db"
    first = service(path)
    pair(first)
    restarted = service(path, "unrelated-generation")
    evaluation = restarted.evaluate_test("test")
    assert evaluation["results"]["mae"]["production"] == 10
    assert evaluation["results"]["mae"]["shadow"] == 30
    assert evaluation["has_comparison"] is True
    assert evaluation["should_rollback"] is True
    assert restarted.get_active_test()["production_version"] == "gen-original"
    assert restarted.get_active_test()["shadow_version"] == "gen-candidate"


def test_process_dictionary_cannot_redefine_authoritative_pair(tmp_path):
    model = service(tmp_path / "experiment.db")
    pair(model)
    model._test_states["test"] = {
        "production_version": "different",
        "shadow_version": "different",
    }
    assert model.evaluate_test("test")["results"]["mae"]["production"] == 10


@pytest.mark.parametrize("status", ["rolled_back", "rollback_failed"])
def test_late_metrics_never_reopen_terminal_experiment(tmp_path, status):
    path = tmp_path / "experiment.db"
    first = service(path)
    pair(first)
    first.mark_test_terminal("test", status)
    restarted = service(path)
    assert restarted.log_metrics("test", "gen-candidate", {"mae": 99}, "late") is False
    assert rows(restarted) == 2
    assert restarted.get_active_test() is None
    assert restarted.ledger.read("test")["status"] == status
    assert restarted.trigger_rollback("test")["reason"] == "Experiment is terminal"


def test_terminal_is_idempotent_and_cannot_be_relabelled(tmp_path):
    model = service(tmp_path / "experiment.db")
    pair(model)
    model.mark_test_terminal("test", "rolled_back")
    model.mark_test_terminal("test", "rollback_failed")
    assert model.ledger.read("test")["status"] == "rolled_back"
    with model.Session() as session:
        assert set(session.scalars(select(ABTestMetrics.status))) == {"rolled_back"}


def test_production_only_experiment_is_not_shadow_routable(tmp_path):
    model = service(tmp_path / "experiment.db")
    model.log_metrics("test", "gen-original", {"mae": 10}, "prod")
    model.traffic_split = 1
    assert model.get_active_test() is None
    assert model.get_model_for_request("new")["test_id"] is None
    model.log_metrics("test", "gen-candidate", {"mae": 20}, "shadow")
    assert model.get_model_for_request("new")["version"] == "gen-candidate"


def test_candidate_binding_is_once_only_across_instances(tmp_path):
    path = tmp_path / "experiment.db"
    a = service(path)
    b = service(path)
    pair(a)
    with pytest.raises(ValueError, match="already bound"):
        b.log_metrics("test", "third-generation", {"mae": 1}, "third")
    assert rows(a) == 2
    assert a.ledger.read("test")["shadow_version"] == "gen-candidate"


@pytest.mark.parametrize(
    "metrics",
    [
        {},
        {"ok": 1, "invalid": float("nan")},
        {"ok": 1, "invalid": float("inf")},
        {"ok": 1, "invalid": True},
        {"ok": 1, "invalid": "2"},
        {"ok": 1, "invalid": 10**400},
        {"": 1},
    ],
)
def test_complete_batch_admitted_before_any_state_or_row_mutation(tmp_path, metrics):
    model = service(tmp_path / "experiment.db")
    with pytest.raises(ValueError):
        model.log_metrics("test", "gen-original", metrics, "request")
    assert rows(model) == 0
    assert model.ledger.read("test") is None


def test_invalid_existing_batch_does_not_bind_shadow(tmp_path):
    model = service(tmp_path / "experiment.db")
    model.log_metrics("test", "gen-original", {"mae": 10}, "prod")
    with pytest.raises(ValueError):
        model.log_metrics(
            "test", "candidate", {"mae": 10, "latency": float("inf")}, "bad"
        )
    assert model.ledger.read("test")["shadow_version"] is None
    assert rows(model) == 1


def test_native_concurrent_candidate_binding_has_exactly_one_winner(tmp_path):
    path = tmp_path / "experiment.db"
    a = service(path)
    b = service(path)
    a.log_metrics("test", "gen-original", {"mae": 10}, "prod")
    barrier = Barrier(2)

    def log(instance, candidate):
        barrier.wait(timeout=5)
        try:
            return candidate, instance.log_metrics(
                "test", candidate, {"mae": 20}, candidate
            )
        except ValueError:
            return candidate, False

    with ThreadPoolExecutor(max_workers=2) as executor:
        futures = [
            executor.submit(log, a, "candidate-A"),
            executor.submit(log, b, "candidate-B"),
        ]
        outcomes = [future.result(timeout=10) for future in futures]
    winner = [name for name, accepted in outcomes if accepted]
    assert len(winner) == 1
    assert a.ledger.read("test")["shadow_version"] == winner[0]
    assert rows(a) == 2


def test_terminal_and_native_metric_transaction_interleaving(tmp_path):
    path = tmp_path / "experiment.db"
    a = service(path)
    b = service(path)
    pair(a)
    barrier = Barrier(2)

    def terminal():
        barrier.wait(timeout=5)
        a.mark_test_terminal("test", "rolled_back")

    def late():
        barrier.wait(timeout=5)
        return b.log_metrics("test", "gen-candidate", {"mae": 20}, "late")

    with ThreadPoolExecutor(max_workers=2) as executor:
        stop = executor.submit(terminal)
        metric = executor.submit(late)
        stop.result(timeout=10)
        admitted = metric.result(timeout=10)
    assert rows(a) == (3 if admitted else 2)
    assert b.get_active_test() is None
    with a.Session() as session:
        assert set(session.scalars(select(ABTestMetrics.status))) == {"rolled_back"}


def legacy(model, versions, status="active"):
    with model.Session.begin() as session:
        session.add_all(
            [
                ABTestMetrics(
                    test_id="old",
                    model_version=version,
                    metric_name="mae",
                    metric_value=value,
                    sample_size=1,
                    status=status,
                    timestamp=datetime(2020, 1, 1, tzinfo=timezone.utc).replace(
                        tzinfo=None
                    ),
                )
                for version, value in versions
            ]
        )


def test_unambiguous_legacy_literal_roles_are_recovered(tmp_path):
    model = service(tmp_path / "experiment.db", "unrelated")
    legacy(model, [("production", 10), ("candidate", 30)])
    assert model.evaluate_test("old")["results"]["mae"] == {
        "production": 10.0,
        "shadow": 30.0,
        "improvement": -200.0,
    }
    assert model.get_active_test()["shadow_version"] == "candidate"


@pytest.mark.parametrize(
    "versions",
    [[("gen1", 10), ("gen2", 30)], [("production", 10), ("a", 20), ("b", 30)]],
)
def test_ambiguous_legacy_rows_do_not_invent_identity(tmp_path, versions):
    model = service(tmp_path / "experiment.db")
    legacy(model, versions)
    report = model.evaluate_test("old")
    assert report["has_comparison"] is False
    assert report["should_rollback"] is False
    assert model.get_active_test() is None
    with pytest.raises(ValueError, match="ambiguous"):
        model.log_metrics("old", "a", {"mae": 20}, "request")
    assert rows(model) == len(versions)


def test_legacy_terminal_wins_over_late_active_rows(tmp_path):
    model = service(tmp_path / "experiment.db")
    legacy(model, [("production", 10), ("candidate", 30)], "rolled_back")
    with model.Session.begin() as session:
        session.add(
            ABTestMetrics(
                test_id="old",
                model_version="candidate",
                metric_name="mae",
                metric_value=99,
                status="active",
                timestamp=datetime(2021, 1, 1, tzinfo=timezone.utc).replace(
                    tzinfo=None
                ),
            )
        )
    assert model.get_active_test() is None
    assert model.ledger.read("old")["status"] == "rolled_back"


def test_terminal_latest_does_not_hide_other_active_test(tmp_path):
    model = service(tmp_path / "experiment.db")
    pair(model, "active")
    pair(model, "ended")
    model.mark_test_terminal("ended", "rolled_back")
    assert model.get_active_test()["test_id"] == "active"


def test_native_atomic_failure_rolls_back_identity_and_all_metrics(tmp_path):
    model = service(tmp_path / "experiment.db")
    with model.engine.begin() as connection:
        connection.exec_driver_sql(
            "CREATE TRIGGER reject_metric BEFORE INSERT ON ab_test_metrics BEGIN SELECT RAISE(ABORT,'test rejection'); END"
        )
    from sqlalchemy.exc import IntegrityError

    with pytest.raises(IntegrityError):
        model.log_metrics("test", "candidate", {"mae": 20, "loss": 5}, "request")
    assert rows(model) == 0
    assert model.ledger.read("test") is None


def test_result_is_strict_json_after_native_restart(tmp_path):
    path = tmp_path / "experiment.db"
    model = service(path)
    pair(model)
    report = service(path).evaluate_test("test")
    json.dumps(report, allow_nan=False)


@pytest.fixture
def http_client(tmp_path, monkeypatch):
    import importlib

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'route-bootstrap.db'}")
    routes = importlib.import_module("routes.ab_testing")
    model = service(tmp_path / "http-ledger.db")
    monkeypatch.setattr(routes, "ab_service", model)
    app = FastAPI()
    app.include_router(routes.router)
    with TestClient(app) as client:
        yield client, model


def test_actual_metrics_route_rejects_invalid_batch_atomically(http_client):
    client, model = http_client
    response = client.post(
        "/ab-testing/metrics",
        content='{"test_id":"test","model_version":"gen-original","metrics":{"mae":10,"loss":NaN},"request_id":"bad"}',
        headers={"content-type": "application/json"},
    )
    assert response.status_code == 422
    assert rows(model) == 0
    assert model.ledger.read("test") is None


def test_actual_metrics_route_reports_ignored_terminal_outcome(http_client):
    client, model = http_client
    pair(model)
    model.mark_test_terminal("test", "rolled_back")
    response = client.post(
        "/ab-testing/metrics",
        json={
            "test_id": "test",
            "model_version": "gen-candidate",
            "metrics": {"mae": 30},
            "request_id": "late",
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "ignored_terminal"
    assert rows(model) == 2


def test_actual_evaluate_route_uses_frozen_pair(http_client):
    client, model = http_client
    pair(model)
    response = client.get("/ab-testing/evaluate/test")
    assert response.status_code == 200
    assert response.json()["results"]["mae"]["production"] == 10
    assert response.json()["results"]["mae"]["shadow"] == 30
