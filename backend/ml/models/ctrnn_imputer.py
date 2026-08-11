import numpy as np

class ContinuousTimeRnnImputer:
    """
    Continuous-Time Recurrent Neural Network (CT-RNN) backed by Neural ODE dynamics
    dh(t)/dt = -h(t) + tanh(W * h(t) + x(t)) for non-uniform telemetry imputation.
    """
    def __init__(self, hidden_dim: int = 4):
        self.hidden_dim = hidden_dim
        self.W = np.eye(hidden_dim) * 0.5
        self.bias = np.zeros(hidden_dim)

    def ode_step(self, h: np.ndarray, dt: float) -> np.ndarray:
        """Euler numerical integration step for Neural ODE hidden state continuous evolution."""
        dh_dt = -h + np.tanh(np.dot(self.W, h) + self.bias)
        return h + (dh_dt * dt)

    def impute_missing_telemetry(self, last_known_coords: tuple, dt_seconds: float) -> tuple:
        """Interpolates smooth lat/lng continuous trajectory across irregular time gap dt_seconds."""
        h = np.array([last_known_coords[0], last_known_coords[1], 0.0, 0.0])
        dt_normalized = dt_seconds / 60.0 # Convert to minutes
        
        # Integrate over continuous time delta
        h_next = self.ode_step(h, dt_normalized)
        
        imputed_lat = float(h_next[0])
        imputed_lng = float(h_next[1])
        return (imputed_lat, imputed_lng)

ctrnn_imputer = ContinuousTimeRnnImputer()
