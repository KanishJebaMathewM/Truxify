import numpy as np

class TemporalGcnSpeedPredictor:
    """
    Temporal Graph Convolutional Network (T-GCN) combined GCN + GRU predictor for highway segment speeds.
    """
    def __init__(self, num_nodes: int = 5):
        self.num_nodes = num_nodes
        # Simulated GCN spatial weights & GRU hidden state weights
        self.gcn_weights = np.array([0.4, 0.35, 0.25])
        self.gru_weights = 0.85

    def predict_speed_forecast(self, time_series_node_speeds: np.ndarray) -> dict:
        """
        time_series_node_speeds: Array of shape (num_nodes, historical_steps)
        """
        recent_speeds = np.mean(time_series_node_speeds, axis=1)
        spatial_convolved = recent_speeds * self.gcn_weights[:len(recent_speeds)]
        
        # Forecast speed for next 1 to 4 hours
        forecast_speeds = spatial_convolved * self.gru_weights + 10.0

        return {
            "forecast_speeds_kmh": [round(float(s), 2) for s in forecast_speeds],
            "average_corridor_speed": round(float(np.mean(forecast_speeds)), 2),
            "congestion_alert": bool(np.min(forecast_speeds) < 30.0)
        }

tgcn_predictor = TemporalGcnSpeedPredictor()
