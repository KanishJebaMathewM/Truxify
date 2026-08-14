# Stub for spec 50
# === Spec 50: max set size ===
MAX_SET_SIZE = 100_000
def validate_set_size(s):
    if not isinstance(s, list): raise TypeError("expected list")
    if len(s) > MAX_SET_SIZE: raise ValueError(f"too large: {len(s)}")
    return s

