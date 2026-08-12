import numpy as np

class BehavioralCloningReRouter:
    """
    Imitation Learning Agent trained on expert fleet driver choices to recommend realistic detour routes.
    """
    def __init__(self):
        # Weights evaluating [speed, slope, congestion_level] -> Detour Preference
        self.policy_weights = np.array([-0.02, -0.5, 2.5])
        self.threshold = 0.5

    def predict_detour_preference(self, speed: float, slope: float, congestion_level: float) -> dict:
        state = np.array([speed, slope, congestion_level])
        logit = float(np.dot(state, self.policy_weights))
        probability = 1.0 / (1.0 + np.exp(-logit))

        recommend_detour = probability > self.threshold

        return {
            "recommend_detour": recommend_detour,
            "detour_probability": round(probability, 4),
            "suggested_route": "Bypass Highway 44" if recommend_detour else "Stay on Main Corridor"
        }

behavioral_cloner = BehavioralCloningReRouter()
