import unittest
from datetime import datetime, timedelta

from twin_model import DigitalTwin, LogisticsEvent, SimulationEngine


class TestSimulationMetrics(unittest.TestCase):
    def setUp(self):
        self.engine = SimulationEngine(DigitalTwin())
        self.base = datetime(2026, 1, 1, 12, 0, 0)

    def _event(self, event_type, timestamp, asset_id="TRUCK_1"):
        return LogisticsEvent(
            id=f"{event_type}_{int(timestamp.timestamp())}",
            type=event_type,
            timestamp=timestamp,
            asset_id=asset_id,
            location={"lat": 25.0, "lng": 75.0},
        )

    def test_utilization_is_zero_to_one_fraction(self):
        # One asset busy for the full 60s window -> utilization 1.0
        events = [
            self._event("pickup", self.base),
            self._event("dropoff", self.base + timedelta(seconds=60)),
        ]
        metrics = self.engine._calculate_metrics(events, {})
        self.assertAlmostEqual(metrics["utilization"], 1.0, places=4)

    def test_utilization_scales_down_with_idle_time(self):
        # Two assets, each busy 10s within a 110s window -> utilization ~0.09
        events = [
            self._event("pickup", self.base, "TRUCK_1"),
            self._event("dropoff", self.base + timedelta(seconds=10), "TRUCK_1"),
            self._event("pickup", self.base + timedelta(seconds=100), "TRUCK_2"),
            self._event("dropoff", self.base + timedelta(seconds=110), "TRUCK_2"),
        ]
        metrics = self.engine._calculate_metrics(events, {})
        self.assertGreaterEqual(metrics["utilization"], 0.0)
        self.assertLessEqual(metrics["utilization"], 1.0)
        self.assertAlmostEqual(metrics["utilization"], 20.0 / 220.0, places=4)

    def test_utilization_bounds_for_short_window(self):
        # Single instantaneous event has no measurable window -> 0.0
        metrics = self.engine._calculate_metrics([self._event("pickup", self.base)], {})
        self.assertEqual(metrics["utilization"], 0.0)

    def test_utilization_zero_for_no_events(self):
        metrics = self.engine._calculate_metrics([], {})
        self.assertEqual(metrics["utilization"], 0.0)
        self.assertEqual(metrics["efficiency"], 0.0)

    def test_efficiency_reflects_delays(self):
        # 3 events, 1 delay -> efficiency 2/3
        events = [
            self._event("pickup", self.base),
            self._event("delay", self.base + timedelta(seconds=10)),
            self._event("dropoff", self.base + timedelta(seconds=20)),
        ]
        metrics = self.engine._calculate_metrics(events, {})
        self.assertAlmostEqual(metrics["efficiency"], 2.0 / 3.0, places=4)

    def test_efficiency_is_perfect_without_delays(self):
        events = [
            self._event("pickup", self.base),
            self._event("dropoff", self.base + timedelta(seconds=10)),
        ]
        metrics = self.engine._calculate_metrics(events, {})
        self.assertEqual(metrics["efficiency"], 1.0)

    def test_recommendations_fire_on_low_utilization(self):
        metrics = {"utilization": 0.1, "efficiency": 0.9, "event_types": {}}
        recs = self.engine._generate_recommendations(metrics)
        self.assertIn("Increase asset utilization by optimizing routes", recs)

    def test_recommendations_fire_on_low_efficiency(self):
        metrics = {"utilization": 0.9, "efficiency": 0.4, "event_types": {}}
        recs = self.engine._generate_recommendations(metrics)
        self.assertIn("Improve operational efficiency by reducing delays", recs)

    def test_recommendations_smooth_when_metrics_healthy(self):
        metrics = {"utilization": 0.9, "efficiency": 0.9, "event_types": {}}
        recs = self.engine._generate_recommendations(metrics)
        self.assertEqual(recs, ["Current operations are running smoothly"])


if __name__ == "__main__":
    unittest.main()
