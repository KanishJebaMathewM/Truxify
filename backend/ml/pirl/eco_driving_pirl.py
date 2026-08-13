# Stub for spec 115
# === Spec 115: soft update ===
DEFAULT_TAU = 0.005
def soft_update(t, s, tau=None):
    tau = tau if tau is not None else DEFAULT_TAU
    if not 0 < tau < 1: raise ValueError(f"tau: {tau}")
    return [tau * x + (1 - tau) * y for y, x in zip(t, s)]

