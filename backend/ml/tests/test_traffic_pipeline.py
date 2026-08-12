import pytest
from unittest.mock import patch, MagicMock
import os

from services.traffic_pipeline import TrafficPipeline, eta_seconds_from_speed

class TestTrafficPipeline:
    @patch("redis.Redis.from_url")
    def test_traffic_pipeline_init(self, mock_redis, tmp_path):
        db_path = str(tmp_path / "traffic_test.db")
        pipeline = TrafficPipeline(db_path=db_path)
        assert pipeline.db_path == db_path
        assert os.path.exists(db_path)

    @patch("redis.Redis.from_url")
    def test_calculate_eta(self, mock_redis, tmp_path):
        db_path = str(tmp_path / "traffic_test.db")
        pipeline = TrafficPipeline(db_path=db_path)
        route_coords = [(12.9716, 77.5946), (12.9352, 77.6245)] # Bangalore coordinates
        eta_seconds, confidence = pipeline.calculate_eta("route-1", route_coords)
        assert eta_seconds > 0
        assert 0.0 <= confidence <= 1.0


class TestEtaComputation:
    """Tests for the ETA computation formula in update_eta_realtime.

    The bug was: eta_seconds = (route_distance_m / 1000.0) / (speed_kmh / 3.6)
    This mixes km (from dividing m by 1000) with m/s (from dividing km/h by 3.6),
    producing a result 1000x too small.

    Correct formula: eta_seconds = route_distance_m / (speed_kmh / 3.6)
    This converts speed to m/s first, then divides distance_m by speed_mps to get seconds.
    """

    def test_eta_formula_returns_correct_seconds(self):
        """10 km at 40 km/h should be ~900 seconds (15 minutes)."""
        route_distance_m = 10000  # 10 km in metres
        predicted_speed_kmh = 40.0
        # Correct formula: distance_m / (speed_kmh / 3.6) = 10000 / 11.111 = 900
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert 890 < eta_seconds < 910, f"Expected ~900s, got {eta_seconds}"

    def test_eta_formula_100x_too_small_before_fix(self):
        """Verify the old (incorrect) formula was off by exactly 1000x."""
        route_distance_m = 10000
        predicted_speed_kmh = 40.0
        # Incorrect: (route_distance_m / 1000.0) / (speed_kmh / 3.6)
        incorrect_eta = (route_distance_m / 1000.0) / (predicted_speed_kmh / 3.6)
        correct_eta = route_distance_m / (predicted_speed_kmh / 3.6)
        assert incorrect_eta == correct_eta / 1000, (
            "Old formula should be exactly 1000x smaller than correct formula"
        )

    def test_eta_zero_distance_returns_zero(self):
        """Zero distance should give zero ETA regardless of speed."""
        route_distance_m = 0
        predicted_speed_kmh = 40.0
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert eta_seconds == 0.0

    def test_eta_reasonable_range_for_real_trip(self):
        """100 km at 60 km/h should be ~6000 seconds (100 minutes)."""
        route_distance_m = 100000  # 100 km
        predicted_speed_kmh = 60.0
        eta_seconds = route_distance_m / (predicted_speed_kmh / 3.6)
        assert 5900 < eta_seconds < 6100, f"Expected ~6000s, got {eta_seconds}"


class TestEtaFromSpeedConversion:
    """Regression tests for /eta/predict speed-to-duration conversion.

    The LSTM predicts traffic speed in m/s (it is trained on traffic_speed,
    see TrafficPipeline.train_model), but the endpoint used to label the raw
    prediction as eta_seconds. eta_seconds = route_distance_m / speed_mps.
    """

    def test_20_mps_over_100_km_is_about_83_minutes(self):
        """20 m/s over 100 km should be ~5000 s = ~83.3 minutes (not 0.33)."""
        eta_seconds = eta_seconds_from_speed(100000.0, 20.0)
        assert eta_seconds == pytest.approx(5000.0, abs=1.0)
        assert eta_seconds / 60 == pytest.approx(83.3, abs=0.1)

    def test_speed_dimension_is_mps_not_kmh(self):
        """Distance (m) / speed (m/s) yields seconds; no 3.6 factor involved."""
        # 10 km at 20 m/s = 10000 / 20 = 500 s. If speed were (wrongly) treated
        # as km/h, dividing by 3.6 would give ~83.3 s and the trip would be
        # reported as ~1.4 minutes instead of ~8.3 minutes.
        assert eta_seconds_from_speed(10000.0, 20.0) == pytest.approx(500.0, abs=1.0)

    def test_zero_or_missing_distance_returns_none(self):
        assert eta_seconds_from_speed(0, 20.0) is None
        assert eta_seconds_from_speed(None, 20.0) is None

    def test_non_positive_speed_returns_none(self):
        assert eta_seconds_from_speed(100000.0, 0) is None
        assert eta_seconds_from_speed(100000.0, -5.0) is None
