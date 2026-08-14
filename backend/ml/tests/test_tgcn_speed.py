"""Unit tests for backend/ml/gnn/tgcn_speed.py.

Run with: python3 -m pytest tests/test_tgcn_speed.py -v --no-header
"""
import numpy as np
import pytest
from gnn.tgcn_speed import TemporalGcnSpeedPredictor


class TestPredictSpeedForecast:
    """Tests for the T-GCN speed forecast.

    The predictor's gcn_weights array has 3 entries, so it only supports
    up to 3 nodes; the tests pin that operating contract.
    """

    def setup_method(self):
        self.predictor = TemporalGcnSpeedPredictor(num_nodes=3)

    def test_returns_expected_keys(self):
        """The result must expose the documented output fields."""
        series = np.full((3, 4), 50.0)
        result = self.predictor.predict_speed_forecast(series)
        assert set(result.keys()) == {
            "forecast_speeds_kmh",
            "average_corridor_speed",
            "congestion_alert",
        }

    def test_forecast_count_matches_node_count(self):
        """One forecast entry per highway node."""
        series = np.full((3, 4), 50.0)
        result = self.predictor.predict_speed_forecast(series)
        assert len(result["forecast_speeds_kmh"]) == 3

    def test_matches_hand_computed_formula(self):
        """forecast = mean_speeds * gcn_weights * 0.85 + 10, rounded to 2dp."""
        series = np.array([
            [60.0, 60.0, 60.0, 60.0],
            [40.0, 40.0, 40.0, 40.0],
            [20.0, 20.0, 20.0, 20.0],
        ])
        result = self.predictor.predict_speed_forecast(series)
        recent = np.mean(series, axis=1)
        expected = recent * np.array([0.4, 0.35, 0.25]) * 0.85 + 10.0
        expected_rounded = [round(float(s), 2) for s in expected]
        assert result["forecast_speeds_kmh"] == expected_rounded

    def test_average_corridor_speed_is_mean_of_forecasts(self):
        """The corridor average must equal the mean forecast speed."""
        series = np.full((3, 4), 50.0)
        result = self.predictor.predict_speed_forecast(series)
        expected = round(float(np.mean(result["forecast_speeds_kmh"])), 2)
        assert result["average_corridor_speed"] == expected

    def test_congestion_alert_when_any_forecast_below_30(self):
        """Low predicted speeds must trigger the congestion alert."""
        series = np.array([
            [10.0, 10.0, 10.0, 10.0],
            [50.0, 50.0, 50.0, 50.0],
            [50.0, 50.0, 50.0, 50.0],
        ])
        result = self.predictor.predict_speed_forecast(series)
        assert result["congestion_alert"] is True

    def test_no_congestion_alert_when_all_forecasts_above_30(self):
        """High predicted speeds must not raise the congestion alert."""
        # 80 km/h across all nodes → forecasts of 37.2 / 33.8 / 27.0 are above 30
        # only for the weighted nodes; use a speed high enough that every
        # weighted forecast stays above 30.
        series = np.full((3, 4), 100.0)
        result = self.predictor.predict_speed_forecast(series)
        assert min(result["forecast_speeds_kmh"]) >= 30.0
        assert result["congestion_alert"] is False

    def test_forecasts_are_rounded_to_2_decimals(self):
        """Every forecast speed must be rounded to 2 decimal places."""
        series = np.array([
            [63.333333, 60.0, 62.0, 58.0],
            [50.0, 50.0, 50.0, 50.0],
            [50.0, 50.0, 50.0, 50.0],
        ])
        result = self.predictor.predict_speed_forecast(series)
        for speed in result["forecast_speeds_kmh"]:
            assert abs(speed - round(speed, 2)) < 1e-9

    def test_more_than_three_nodes_raises(self):
        """The fixed 3-entry gcn_weights array limits the predictor to 3 nodes."""
        predictor = TemporalGcnSpeedPredictor(num_nodes=5)
        with pytest.raises(ValueError):
            predictor.predict_speed_forecast(np.full((5, 4), 50.0))
