import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.ab_testing import ABTestModel


def test_evaluate_test_compares_real_shadow_version(tmp_path, monkeypatch):
    db_path = tmp_path / "ab_test.db"
    service = ABTestModel(f"sqlite:///{db_path}")

    monkeypatch.setattr(service, "get_production_version", lambda: "production_v1")

    service.log_metrics("test_001", "production_v1", {"rmse": 10.0}, "prod")
    service.log_metrics("test_001", "shadow_v2", {"rmse": 5.0}, "shadow")

    result = service.evaluate_test("test_001")

    assert result["results"]["rmse"]["production"] == 10.0
    assert result["results"]["rmse"]["shadow"] == 5.0
    assert result["shadow_better"] is True
    assert result["should_rollback"] is False


def test_evaluate_test_does_not_rollback_without_comparable_metrics(
    tmp_path, monkeypatch
):
    db_path = tmp_path / "ab_test.db"
    service = ABTestModel(f"sqlite:///{db_path}")

    monkeypatch.setattr(service, "get_production_version", lambda: "production_v1")

    service.log_metrics("test_002", "shadow_v2", {"rmse": 5.0}, "shadow")

    result = service.evaluate_test("test_002")

    assert result["results"]["rmse"]["production"] is None
    assert result["results"]["rmse"]["shadow"] == 5.0
    assert result["shadow_better"] is False
    assert result["should_rollback"] is False


def test_trigger_rollback_returns_insufficient_metrics(tmp_path, monkeypatch):
    db_path = tmp_path / "ab_test.db"
    service = ABTestModel(f"sqlite:///{db_path}")

    monkeypatch.setattr(service, "get_production_version", lambda: "production_v1")

    service.log_metrics("test_003", "shadow_v2", {"rmse": 5.0}, "shadow")

    result = service.trigger_rollback("test_003")

    assert result["action"] == "insufficient_metrics"
    assert result["test_id"] == "test_003"
    assert result["reason"] == "Production and shadow metrics are not comparable"
