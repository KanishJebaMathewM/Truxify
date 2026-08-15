import numpy as np

class SpikingNeuralNetworkFatigueDetector:
    """
    Spiking Neural Network (SNN) Fatigue Detector using Leaky Integrate-and-Fire (LIF) neuron model.
    Models event-driven temporal spikes to assess driver fatigue from eye-blink durations.
    """
    def __init__(self, threshold: float = 1.0, decay_rate: float = 0.9, sustained_frames: int = 4):
        self.threshold = threshold
        self.decay = decay_rate
        self.sustained_frames = sustained_frames
        self.membrane_potential = 0.0

    def process_spike_train(self, temporal_blinks: np.ndarray) -> dict:
        """
        temporal_blinks: Binary array representing eye closed state over consecutive frames (1 = closed).
        """
        spikes = []
        self.membrane_potential = 0.0
        max_closed_run = 0
        current_closed_run = 0

        for state in temporal_blinks:
            # Integrate incoming signal & apply decay dynamics
            self.membrane_potential = (self.membrane_potential * self.decay) + float(state)

            if int(state) == 1:
                current_closed_run += 1
                if current_closed_run > max_closed_run:
                    max_closed_run = current_closed_run
            else:
                current_closed_run = 0

            if self.membrane_potential >= self.threshold:
                spikes.append(1)
                self.membrane_potential -= self.threshold # Reset potential
            else:
                spikes.append(0)

        total_spikes = sum(spikes)
        # Fatigue requires sustained eye closure, not short blinks. A run of
        # only a few closed frames (a normal blink, ~0.1s) must not trip the
        # detector, so use the longest sustained closed-eye duration instead
        # of the loose total-spike ratio that fires on every blink.
        fatigue_detected = max_closed_run >= self.sustained_frames

        return {
            "total_cycles": len(temporal_blinks),
            "generated_spikes_count": total_spikes,
            "final_membrane_potential": round(self.membrane_potential, 4),
            "max_closed_run": max_closed_run,
            "fatigue_detected": fatigue_detected
        }

snn_fatigue_detector = SpikingNeuralNetworkFatigueDetector()
