"""Unit tests for backend/ml/services/ab_testing.py (pure helpers).

Run with: python3 -m pytest tests/test_ab_testing_model.py -v --no-header
"""

from services.ab_testing import ABTestModel


def make_model(threshold=0.95):
    """Build an ABTestModel without touching the database engine."""
    model = object.__new__(ABTestModel)
    model.threshold = threshold
    return model


def test_evaluation_uses_persisted_production_generation(tmp_path, monkeypatch):
    """A native restart must compare the generations actually admitted."""
    model = ABTestModel(f"sqlite:///{tmp_path / 'pair.db'}")
    monkeypatch.setattr(model, "get_production_version", lambda: "gen_current")
    model.log_metrics("demand-test", "gen_current", {"mae": 10.0}, "prod")
    model.log_metrics("demand-test", "gen_candidate", {"mae": 5.0}, "shadow")
    restarted = ABTestModel(f"sqlite:///{tmp_path / 'pair.db'}")
    monkeypatch.setattr(restarted, "get_production_version", lambda: "unrelated")
    result = restarted.evaluate_test("demand-test")
    assert result["results"]["mae"]["production"] == 10.0
    assert result["results"]["mae"]["shadow"] == 5.0
    assert result["shadow_better"] is True


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
            "loss": {"production": 0.5, "shadow": 0.6},  # shadow worse
            "latency": {"production": 1.0, "shadow": 0.8},  # shadow better
        }
        assert model.is_shadow_better(results) is True

    def test_threshold_gates_the_decision(self):
        """The threshold must gate the comparison."""
        model = make_model(threshold=0.99)
        results = {"accuracy": {"production": 1.0, "shadow": 0.99}}
        # shadow == prod * threshold → not strictly better
        assert model.is_shadow_better(results) is False


class TestEvaluateTest:
    """Tests for production vs shadow metric evaluation."""

    def test_no_shadow_metrics_does_not_trigger_rollback(self, tmp_path):
        """Missing shadow metrics must not silently trigger rollback."""
        db_path = tmp_path / "ab_test.db"
        model = ABTestModel(f"sqlite:///{db_path}")

        model.log_metrics(
            test_id="test_1",
            model_version="production",
            metrics={"accuracy": 0.90},
            request_id="request_1",
        )

        result = model.evaluate_test("test_1")

        assert result["should_rollback"] is False
        assert (
            result["error"]
            == "Insufficient metrics for production vs shadow comparison"
        )

    def test_trigger_rollback_does_not_promote_without_shadow_metrics(self, tmp_path):
        """Missing shadow metrics must not result in a promote action."""
        db_path = tmp_path / "ab_test.db"
        model = ABTestModel(f"sqlite:///{db_path}")

        model.log_metrics(
            test_id="test_rollback",
            model_version="production",
            metrics={"accuracy": 0.90},
            request_id="request_1",
        )

        result = model.trigger_rollback("test_rollback")

        assert result["action"] == "none"
        assert (
            result["reason"]
            == "Insufficient metrics for production vs shadow comparison"
        )

    def test_uses_real_shadow_version(self, tmp_path):
        """Evaluation must use the actual logged shadow model version."""
        db_path = tmp_path / "ab_test.db"
        model = ABTestModel(f"sqlite:///{db_path}")

        model.log_metrics(
            test_id="test_2",
            model_version="production",
            metrics={"accuracy": 0.90},
            request_id="request_1",
        )

        model.log_metrics(
            test_id="test_2",
            model_version="v2",
            metrics={"accuracy": 0.95},
            request_id="request_2",
        )

        result = model.evaluate_test("test_2")

        assert result["results"]["accuracy"]["production"] == 0.90
        assert result["results"]["accuracy"]["shadow"] == 0.95
        assert result["should_rollback"] is False
