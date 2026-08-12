import unittest
from twin_simulator import TruckDigitalTwinSimulator

class TestDigitalTwin(unittest.TestCase):
    def setUp(self):
        self.simulator = TruckDigitalTwinSimulator("TEST_TRUCK_99")

    def test_telemetry_twin_update(self):
        initial_temp = self.simulator.engine_temp_c
        res = self.simulator.update_telemetry(speed_kmh=75.0, engine_rpm=2200.0, ambient_temp_c=35.0)

        self.assertGreater(res["engine_temp_c"], initial_temp)
        self.assertIn("failure_risk_pct", res)
        self.assertIsInstance(res["requires_maintenance"], bool)

if __name__ == '__main__':
    unittest.main()
