import unittest
from twin_simulator import TruckDigitalTwinSimulator

class TestDigitalTwin(unittest.TestCase):
    def setUp(self):
        self.simulator = TruckDigitalTwinSimulator("TEST_TRUCK_99")

    def test_telemetry_twin_update(self):
        res = self.simulator.update_telemetry(speed_kmh=75.0, engine_rpm=2200.0, ambient_temp_c=35.0)

        self.assertIn("failure_risk_pct", res)
        self.assertIsInstance(res["requires_maintenance"], bool)

    def test_telemetry_converges_to_equilibrium(self):
        sim = self.simulator
        for _ in range(20000):
            sim.update_telemetry(speed_kmh=75.0, engine_rpm=2200.0, ambient_temp_c=35.0)

        self.assertLessEqual(sim.engine_temp_c, 100.0)
        self.assertGreaterEqual(sim.tire_pressure_psi, 105.0)
        self.assertLessEqual(sim.brake_pad_wear_pct, 100.0)

if __name__ == '__main__':
    unittest.main()
