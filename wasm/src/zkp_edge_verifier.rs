use sha2::{Digest, Sha256};
use wasm_bindgen::prelude::*;

/// Verifying key shared by the edge proxies and the prover. A proof is only
/// accepted when its bytes are exactly the keyed commitment of the public
/// statement under this key, so a caller cannot forge a valid proof by
/// prefixing arbitrary bytes with `0xzk` / `0xbproof_`. Replace with the
/// verifying key of a real Groth16/Plonk circuit when one is deployed.
const EDGE_VERIFYING_KEY: &[u8] = b"truxify.wasm.zkp.edge.v1.verifying.key.0123456789abcdef";

/// HMAC-SHA256 keyed PRF used as the circuit's proving/verifying function.
fn hmac_sha256(key: &[u8], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;

    let mut k = [0u8; BLOCK];
    if key.len() > BLOCK {
        let hash = Sha256::digest(key);
        k[..hash.len()].copy_from_slice(&hash[..]);
    } else {
        k[..key.len()].copy_from_slice(key);
    }

    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for i in 0..BLOCK {
        inner_pad[i] ^= k[i];
        outer_pad[i] ^= k[i];
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    let digest = outer.finalize();

    let mut out = [0u8; 32];
    out.copy_from_slice(&digest[..]);
    out
}

/// Constant-time byte comparison to avoid leaking how many bytes matched.
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for i in 0..a.len() {
        diff |= a[i] ^ b[i];
    }
    diff == 0
}

/// The only proof accepted by the edge circuit for the given public statement.
fn expected_proof(public_inputs_hex: &str) -> [u8; 32] {
    hmac_sha256(EDGE_VERIFYING_KEY, public_inputs_hex.as_bytes())
}

/// High-speed Zero-Knowledge Proof Verifier running directly inside WASM edge
/// proxies.
#[wasm_bindgen]
pub fn verify_zkp_edge_wasm(proof_bytes_hex: &str, public_inputs_hex: &str) -> bool {
    if proof_bytes_hex.is_empty() || public_inputs_hex.is_empty() {
        return false;
    }

    // Real verification: the proof must be a valid, even-length hex encoding of
    // exactly the keyed commitment of the public statement. Forged proofs that
    // merely carry a `0xzk`/`0xbproof_` prefix are rejected.
    match hex::decode(proof_bytes_hex) {
        Ok(proof_bytes) => constant_time_eq(&proof_bytes, &expected_proof(public_inputs_hex)),
        Err(_) => false,
    }
}

#[wasm_bindgen]
pub fn get_wasm_edge_verifier_version() -> String {
    "Truxify_WASM_ZKP_v1.0.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn genuine_proof(public_inputs_hex: &str) -> String {
        hex::encode(expected_proof(public_inputs_hex))
    }

    #[test]
    fn rejects_empty_inputs() {
        assert!(!verify_zkp_edge_wasm("", "deadbeef"));
        assert!(!verify_zkp_edge_wasm("deadbeef", ""));
    }

    #[test]
    fn rejects_prefix_forged_proof() {
        // `0xzk` / `0xbproof_` prefixed garbage must never verify.
        assert!(!verify_zkp_edge_wasm("0xzkdeadbeef", "deadbeef"));
        assert!(!verify_zkp_edge_wasm("0xbproof_0000", "deadbeef"));
    }

    #[test]
    fn rejects_non_hex_proof() {
        assert!(!verify_zkp_edge_wasm("zzzz-not-hex", "deadbeef"));
    }

    #[test]
    fn rejects_garbage_hex_proof() {
        assert!(!verify_zkp_edge_wasm("4a8f9b2c1d3e5f", "deadbeef"));
    }

    #[test]
    fn accepts_genuine_proof() {
        let proof = genuine_proof("deadbeef");
        assert!(verify_zkp_edge_wasm(&proof, "deadbeef"));
    }

    #[test]
    fn proof_is_bound_to_public_inputs() {
        // A genuine proof for inputs A must not verify inputs B.
        let proof = genuine_proof("deadbeef");
        assert!(!verify_zkp_edge_wasm(&proof, "cafebabe"));
    }
}
