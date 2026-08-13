import unittest
import numpy as np
from fatigue_snn import SpikingNeuralNetworkFatigueDetector

class TestSnnFatigue(unittest.TestCase):
    def setUp(self):
        self.detector = SpikingNeuralNetworkFatigueDetector(threshold=1.0, decay_rate=0.9)

    def test_fatigue_alert_generation(self):
        # Simulated continuous eye closure (heavy drowsiness)
        blink_inputs = np.array([1, 1, 1, 1, 1, 0, 1, 1, 1, 1])
        res = self.detector.process_spike_train(blink_inputs)
        
        self.assertTrue(res["fatigue_detected"])
        self.assertGreater(res["generated_spikes_count"], 0)

    def test_alert_normal_state(self):
        # Normal active blink rate
        blink_inputs = np.array([0, 0, 0, 1, 0, 0, 0, 0, 1, 0])
        res = self.detector.process_spike_train(blink_inputs)
        
        self.assertFalse(res["fatigue_detected"])

    def test_short_blink_not_fatigue(self):
        # A short blink (3 consecutive closed frames ~= 0.1s) must not alarm
        blink_inputs = np.array([1, 1, 1, 0])
        res = self.detector.process_spike_train(blink_inputs)

        self.assertFalse(res["fatigue_detected"])
        self.assertLess(res["max_closed_run"], self.detector.sustained_frames)

    def test_isolated_blinks_not_fatigue(self):
        # Three isolated blinks across the window must not alarm either
        blink_inputs = np.array([1, 0, 0, 1, 0, 0, 1, 0, 0])
        res = self.detector.process_spike_train(blink_inputs)

        self.assertFalse(res["fatigue_detected"])

    def test_sustained_closure_alarms(self):
        # Prolonged closure (sustained run) must alarm
        blink_inputs = np.array([1, 1, 1, 1, 1, 1, 1, 1, 1, 1])
        res = self.detector.process_spike_train(blink_inputs)

        self.assertTrue(res["fatigue_detected"])

if __name__ == '__main__':
    unittest.main()
