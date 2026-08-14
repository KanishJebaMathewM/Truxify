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
        # Standardize raw degree coordinates into ~[-1, 1] before feeding them to
        # the tanh-based ODE. Feeding degree-scale values (up to +/-90 / +/-180)
        # saturates tanh immediately and drags the state far outside valid bounds.
        LAT_SCALE = 90.0
        LNG_SCALE = 180.0
        lat_scaled = last_known_coords[0] / LAT_SCALE
        lng_scaled = last_known_coords[1] / LNG_SCALE

        h = np.array([lat_scaled, lng_scaled, 0.0, 0.0])
        dt_normalized = dt_seconds / 60.0  # Convert to minutes

        # Integrate over continuous time delta in scaled space
        h_next = self.ode_step(h, dt_normalized)

        # Inverse-transform back to degrees
        imputed_lat = float(h_next[0]) * LAT_SCALE
        imputed_lng = float(h_next[1]) * LNG_SCALE

        # Clamp to valid geographic bounds so downstream route/ETA consumers
        # never receive out-of-range coordinates.
        imputed_lat = max(-90.0, min(90.0, imputed_lat))
        imputed_lng = max(-180.0, min(180.0, imputed_lng))
        return (imputed_lat, imputed_lng)

ctrnn_imputer = ContinuousTimeRnnImputer()
