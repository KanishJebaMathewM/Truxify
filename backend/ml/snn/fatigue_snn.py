import numpy as np

class SpikingNeuralNetworkFatigueDetector:
    """
    Spiking Neural Network (SNN) Fatigue Detector using Leaky Integrate-and-Fire (LIF) neuron model.
    Models event-driven temporal spikes to assess driver fatigue from eye-blink durations.
    """
    def __init__(self, threshold: float = 1.0, decay_rate: float = 0.9):
        self.threshold = threshold
        self.decay = decay_rate
        self.membrane_potential = 0.0

    def process_spike_train(self, temporal_blinks: np.ndarray) -> dict:
        """
        temporal_blinks: Binary array representing eye closed state over consecutive frames (1 = closed).
        """
        spikes = []
        self.membrane_potential = 0.0

        for state in temporal_blinks:
            # Integrate incoming signal & apply decay dynamics
            self.membrane_potential = (self.membrane_potential * self.decay) + float(state)
            
            if self.membrane_potential >= self.threshold:
                spikes.append(1)
                self.membrane_potential -= self.threshold # Reset potential
            else:
                spikes.append(0)

        total_spikes = sum(spikes)
        fatigue_detected = total_spikes > (len(temporal_blinks) * 0.3)

        return {
            "total_cycles": len(temporal_blinks),
            "generated_spikes_count": total_spikes,
            "final_membrane_potential": round(self.membrane_potential, 4),
            "fatigue_detected": fatigue_detected
        }

snn_fatigue_detector = SpikingNeuralNetworkFatigueDetector()
