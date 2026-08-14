use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct LwwElement<T: Clone> {
    pub value: T,
    pub timestamp: u64,
}

#[wasm_bindgen]
pub fn merge_lww_elements(val_a: &str, ts_a: u64, val_b: &str, ts_b: u64) -> (String, u64) {
    // Last-Write-Wins (LWW) CRDT state resolution logic
    if ts_a > ts_b || (ts_a == ts_b && val_a >= val_b) {
        (val_a.to_string(), ts_a)
    } else {
        (val_b.to_string(), ts_b)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn merge_is_commutative_on_timestamp_tie() {
        // Replicas applying the same two updates in opposite order must
        // converge to the same value (LWW CRDT convergence guarantee).
        let (a_val, a_ts) = merge_lww_elements("value_a", 100, "value_b", 100);
        let (b_val, b_ts) = merge_lww_elements("value_b", 100, "value_a", 100);
        assert_eq!(a_val, b_val);
        assert_eq!(a_ts, b_ts);
    }

    #[test]
    fn merge_picks_higher_timestamp_regardless_of_order() {
        let (a_val, a_ts) = merge_lww_elements("older", 50, "newer", 200);
        let (b_val, b_ts) = merge_lww_elements("newer", 200, "older", 50);
        assert_eq!(a_val, b_val);
        assert_eq!(a_val, "newer");
        assert_eq!(a_ts, b_ts);
        assert_eq!(a_ts, 200);
    }
}
