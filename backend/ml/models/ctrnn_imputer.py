import numpy as np
from scipy.integrate import solve_ivp

class ContinuousTimeRnnImputer:
    """
    Continuous-Time Recurrent Neural Network (CT-RNN) backed by Neural ODE dynamics
    dh(t)/dt = -h(t) + tanh(W * h(t) + x(t)) for non-uniform telemetry imputation.
    """
    def __init__(self, hidden_dim: int = 4):
        if isinstance(hidden_dim, bool) or not isinstance(hidden_dim, (int, np.integer)) or hidden_dim < 2:
            raise ValueError("hidden_dim must be an integer of at least two")
        self.hidden_dim = hidden_dim
        self.W = np.eye(hidden_dim) * 0.5
        self.bias = np.zeros(hidden_dim)

    def ode_step(self, h: np.ndarray, dt: float) -> np.ndarray:
        """Euler numerical integration step for Neural ODE hidden state continuous evolution."""
        dh_dt = -h + np.tanh(np.dot(self.W, h) + self.bias)
        return h + (dh_dt * dt)

    def impute_missing_telemetry(self, last_known_coords: tuple, dt_seconds: float) -> tuple:
        """Interpolates smooth lat/lng continuous trajectory across irregular time gap dt_seconds."""
        # Admit a complete immutable numerical problem before calling the solver.
        coords = np.asarray(last_known_coords)
        if coords.shape != (2,) or coords.dtype.kind not in "iuf" or not np.isfinite(coords).all():
            raise ValueError("coordinates must be two finite real numbers")
        coords = coords.astype(np.float64, copy=True)
        scales = np.array([90.0, 180.0])
        if np.any(np.abs(coords) > scales):
            raise ValueError("coordinates are outside geographic bounds")
        if (isinstance(dt_seconds, (bool, np.bool_))
                or not isinstance(dt_seconds, (int, float, np.integer, np.floating))
                or not np.isfinite(dt_seconds) or dt_seconds < 0):
            raise ValueError("dt_seconds must be finite and nonnegative")
        weights, bias = np.asarray(self.W), np.asarray(self.bias)
        if (weights.shape != (self.hidden_dim, self.hidden_dim)
                or bias.shape != (self.hidden_dim,)
                or weights.dtype.kind not in "iuf" or bias.dtype.kind not in "iuf"
                or not np.isfinite(weights).all() or not np.isfinite(bias).all()):
            raise ValueError("dynamics must have finite matching real dimensions")
        weights = weights.astype(np.float64, copy=True)
        bias = bias.astype(np.float64, copy=True)
        if dt_seconds == 0:
            return tuple(float(value) for value in coords)

        h = np.zeros(self.hidden_dim, dtype=np.float64)
        h[:2] = coords / scales
        duration = float(dt_seconds) / 60.0
        if duration == 0.0:  # Positive subnormal seconds can underflow in minutes.
            return tuple(float(value) for value in coords)
        evaluations = 0

        def dynamics(_time, state):
            nonlocal evaluations
            evaluations += 1
            # An enormous gap or pathological field must not monopolize a worker.
            if evaluations > 20000:
                raise RuntimeError("CTRNN integration exceeded its evaluation budget")
            with np.errstate(over="ignore", invalid="ignore"):
                activation = weights @ state + bias
                derivative = -state + np.tanh(activation)
            if not np.isfinite(activation).all() or not np.isfinite(derivative).all():
                raise RuntimeError("CTRNN dynamics produced nonfinite values")
            return derivative

        # Only store the requested endpoint. Adaptive RK45 controls local error;
        # a single Euler step is unstable for otherwise ordinary telemetry gaps.
        solution = solve_ivp(dynamics, (0.0, duration), h, method="RK45",
                             t_eval=[duration], rtol=1e-9, atol=1e-12)
        if (not solution.success or len(solution.t) != 1 or solution.t[0] != duration
                or np.shape(solution.y) != (self.hidden_dim, 1)
                or not np.isfinite(solution.y).all()):
            raise RuntimeError("CTRNN integration did not reach a finite endpoint")
        degrees = solution.y[:2, 0] * scales
        return tuple(float(value) for value in np.clip(degrees, -scales, scales))

ctrnn_imputer = ContinuousTimeRnnImputer()
