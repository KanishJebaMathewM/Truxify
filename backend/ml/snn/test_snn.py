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

if __name__ == '__main__':
    unittest.main()
