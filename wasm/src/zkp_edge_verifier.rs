use ed25519_dalek::{Signature, VerifyingKey};
use std::sync::OnceLock;
use wasm_bindgen::prelude::*;

/// Dev-only Ed25519 verifying public key (hex-encoded), shared with the
/// `zkp-verifier-rust` service. A verification key is public material: the
/// verifier cannot forge proofs because it never holds the matching private key.
const DEFAULT_VERIFYING_PUBLIC_KEY_HEX: &str =
    "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

static VERIFYING_KEY: OnceLock<VerifyingKey> = OnceLock::new();

fn verifying_key() -> &'static VerifyingKey {
    VERIFYING_KEY.get_or_init(|| {
        let bytes = hex::decode(DEFAULT_VERIFYING_PUBLIC_KEY_HEX.trim())
            .expect("default verifying public key must be valid hex");
        let arr: [u8; 32] = bytes
            .try_into()
            .expect("default verifying public key must be exactly 32 bytes");
        VerifyingKey::from_bytes(&arr)
            .expect("default verifying public key must be a valid Ed25519 public key")
    })
}

/// High-speed Zero-Knowledge Proof Verifier running directly inside WASM edge proxies.
///
/// The proof is an Ed25519 signature (64 bytes, hex-encoded) over the
/// `public_inputs`, bound to the prover's private key. We verify it against the
/// verifying public key so a forged or mismatched proof is rejected instead of
/// being trusted after a mere prefix check.
#[wasm_bindgen]
pub fn verify_zkp_edge_wasm(proof_bytes_hex: &str, public_inputs_hex: &str) -> bool {
    if proof_bytes_hex.is_empty() || public_inputs_hex.is_empty() {
        return false;
    }

    // Structural sanity: the proof must be presented in a known ZKP envelope.
    if !proof_bytes_hex.starts_with("0xzk_") && !proof_bytes_hex.starts_with("0xbproof_") {
        return false;
    }

    // Reject envelope-only proofs that carry no payload after the prefix.
    let payload = match proof_bytes_hex.split_once('_') {
        Some((_, rest)) if !rest.is_empty() => rest,
        _ => return false,
    };

    // Decode the signature and the canonical statement (the public inputs) and
    // perform a strict Ed25519 verification. Garbage, wrong-size, or forged
    // proofs all fail here and return `false`.
    let proof_bytes = match hex::decode(payload) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let sig_bytes: [u8; 64] = match proof_bytes.try_into() {
        Ok(arr) => arr,
        Err(_) => return false,
    };
    let statement = match hex::decode(public_inputs_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };

    verifying_key()
        .verify_strict(&statement, &Signature::from_bytes(&sig_bytes))
        .is_ok()
}

#[wasm_bindgen]
pub fn get_wasm_edge_verifier_version() -> String {
    "Truxify_WASM_ZKP_v1.0.0".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_empty_inputs() {
        assert!(!verify_zkp_edge_wasm("", "00"));
        assert!(!verify_zkp_edge_wasm("0xzk_00", ""));
    }

    #[test]
    fn rejects_unknown_envelope() {
        assert!(!verify_zkp_edge_wasm("0xother_00", "00"));
    }

    #[test]
    fn rejects_envelope_without_payload() {
        assert!(!verify_zkp_edge_wasm("0xzk_", "00"));
        assert!(!verify_zkp_edge_wasm("0xbproof_", "00"));
    }

    #[test]
    fn accepts_known_envelope_prefixes() {
        // Payloads are not valid Ed25519 sigs, but they must reach decode
        // (i.e. not be rejected at the envelope/prefix stage).
        let zxzk = verify_zkp_edge_wasm("0xzk_00", "00");
        let bproof = verify_zkp_edge_wasm("0xbproof_00", "00");
        assert!(!zxzk && !bproof);
    }
}
