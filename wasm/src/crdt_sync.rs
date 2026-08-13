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
