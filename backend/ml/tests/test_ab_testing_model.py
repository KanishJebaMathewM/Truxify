"""Unit tests for backend/ml/services/ab_testing.py (pure helpers).

Run with: python3 -m pytest tests/test_ab_testing_model.py -v --no-header
"""
from services.ab_testing import ABTestModel


def make_model(threshold=0.95):
    """Build an ABTestModel without touching the database engine."""
    model = object.__new__(ABTestModel)
    model.threshold = threshold
    return model


class TestCalculateImprovement:
    """Tests for the improvement-percentage helper."""

    def test_higher_is_better_positive(self):
        """A higher shadow value must yield a positive improvement."""
        model = make_model()
        assert model.calculate_improvement(100.0, 110.0, higher_is_better=True) == 10.0

    def test_higher_is_better_negative(self):
        """A lower shadow value must yield a negative improvement."""
        model = make_model()
        assert model.calculate_improvement(100.0, 90.0, higher_is_better=True) == -10.0

    def test_lower_is_better_positive(self):
        """For lower-is-better metrics a smaller shadow value is a positive improvement."""
        model = make_model()
        assert model.calculate_improvement(10.0, 9.0, higher_is_better=False) == 10.0

    def test_zero_production_value(self):
        """A zero production value must not divide by zero."""
        model = make_model()
        # shadow 10, prod 0, higher-is-better → +1000%
        assert model.calculate_improvement(0.0, 10.0, higher_is_better=True) == 1000.0
        # both zero → 0%
        assert model.calculate_improvement(0.0, 0.0, higher_is_better=True) == 0.0


class TestIsShadowBetter:
    """Tests for the shadow-vs-production decision."""

    def test_no_metrics_returns_false(self):
        """An empty results dict must not flag the shadow model as better."""
        model = make_model()
        assert model.is_shadow_better({}) is False

    def test_better_for_higher_is_better_metric(self):
        """A higher shadow value on an accuracy-style metric must win."""
        model = make_model()
        results = {"accuracy": {"production": 0.9, "shadow": 0.95}}
        assert model.is_shadow_better(results) is True

    def test_better_for_lower_is_better_metric(self):
        """A lower shadow value on a loss-style metric must win."""
        model = make_model()
        results = {"loss": {"production": 0.5, "shadow": 0.4}}
        assert model.is_shadow_better(results) is True

    def test_worse_for_higher_is_better_metric(self):
        """A lower shadow value on an accuracy-style metric must lose."""
        model = make_model()
        results = {"accuracy": {"production": 0.95, "shadow": 0.90}}
        assert model.is_shadow_better(results) is False

    def test_mixed_metrics_require_majority(self):
        """The shadow model must win on more than half of the metrics."""
        model = make_model()
        results = {
            "accuracy": {"production": 0.9, "shadow": 0.95},  # shadow better
            "loss": {"production": 0.5, "shadow": 0.6},       # shadow worse
            "latency": {"production": 1.0, "shadow": 0.8},    # shadow better
        }
        assert model.is_shadow_better(results) is True

    def test_threshold_gates_the_decision(self):
        """The threshold must gate the comparison."""
        model = make_model(threshold=0.99)
        results = {"accuracy": {"production": 1.0, "shadow": 0.99}}
        # shadow == prod * threshold → not strictly better
        assert model.is_shadow_better(results) is False


class TestEvaluateAndRollback:
    """Database-backed tests for evaluate_test and trigger_rollback."""

    def make_db_model(self):
        from datetime import datetime
        from services.ab_testing import ABTestVersion
        model = ABTestModel("sqlite:///:memory:")
        session = model.Session()
        session.add(ABTestVersion(
            version="v1",
            status="production",
            created_at=datetime.utcnow(),
        ))
        session.commit()
        session.close()
        return model

    def test_get_production_version_reads_registry(self):
        model = self.make_db_model()
        assert model.get_production_version() == "v1"

    def test_get_production_version_defaults_when_empty(self):
        model = ABTestModel("sqlite:///:memory:")
        assert model.get_production_version() == "production"

    def test_evaluate_returns_metrics_degradation(self):
        model = self.make_db_model()
        model.log_metrics("t1", "production", {"accuracy": 0.9, "rmse": 5.0}, "r1")
        model.log_metrics("t1", "shadow", {"accuracy": 0.6, "rmse": 9.0}, "r2")
        result = model.evaluate_test("t1")
        assert "metrics" in result
        assert result["metrics"]["degradation"] > 0.15
        assert result["metrics"]["mean_improvement"] < 0
        assert result["should_rollback"] is True

    def test_rollback_restores_previous_version_in_registry(self):
        model = self.make_db_model()
        model.log_metrics("t1", "production", {"accuracy": 0.9}, "r1")
        model.log_metrics("t1", "shadow", {"accuracy": 0.5}, "r2")
        result = model.trigger_rollback("t1")
        assert result["action"] == "rollback"
        assert result["production_version"] == "v1"
        assert result["previous_version"] == "shadow"
        assert result["production_version"] != result["previous_version"]
        # The rollback actually mutated the registry.
        assert model.get_production_version() == "v1"

    def test_promote_promotes_shadow_in_registry(self):
        model = self.make_db_model()
        model.log_metrics("t2", "production", {"accuracy": 0.8}, "r3")
        model.log_metrics("t2", "shadow", {"accuracy": 0.95}, "r4")
        result = model.trigger_rollback("t2")
        assert result["action"] == "promote"
        assert result["production_version"] == "shadow"
        assert result["previous_version"] == "v1"
        assert model.get_production_version() == "shadow"
