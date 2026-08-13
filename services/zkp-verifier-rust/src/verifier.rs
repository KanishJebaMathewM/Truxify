use crate::weight_proof::{canonical_payload, WeightProofOutput};
use ed25519_dalek::{Signature, VerifyingKey};

/// Maximum allowed skew (seconds) between the device timestamp and the
/// verifier clock. Proofs stamped further in the future (or further in the
/// past) are rejected to keep the weight claim fresh.
const MAX_TIMESTAMP_SKEW_SECS: u64 = 300;

pub struct ZkWeightVerifier;

impl ZkWeightVerifier {
    /// Independently enforces the weight limit and verifies the Ed25519
    /// signature over the canonical payload (weight + device limit + nonce +
    /// timestamp), which only the weighing device's secret key can produce.
    ///
    /// The prover's self-declared validity is never trusted: the claimed axle
    /// weight is re-checked against the verifier's own `max_allowed_limit`.
    pub fn verify_proof(
        proof: &WeightProofOutput,
        max_allowed_limit: u64,
        verifying_key: &VerifyingKey,
        now: u64,
    ) -> bool {
        // 1. Independent weight enforcement against the caller's limit.
        if proof.axle_weight_kg > max_allowed_limit {
            return false;
        }

        // 2. Timestamp freshness: reject future-stamped proofs (beyond clock
        //    skew) and stale proofs (older than the skew window).
        if proof.timestamp > now.saturating_add(MAX_TIMESTAMP_SKEW_SECS) {
            return false;
        }
        if proof.timestamp < now.saturating_sub(MAX_TIMESTAMP_SKEW_SECS) {
            return false;
        }

        // 3. Signature check over the exact canonical payload that was signed.
        //    A tampered weight, limit, nonce, or timestamp breaks the binding.
        let payload = canonical_payload(
            proof.axle_weight_kg,
            proof.max_legal_limit_kg,
            &proof.nonce,
            proof.timestamp,
        );

        match hex::decode(&proof.signature_hex) {
            Ok(bytes) => match <[u8; 64]>::try_from(bytes.as_slice()) {
                Ok(sig_bytes) => verifying_key
                    .verify_strict(&payload, &Signature::from_bytes(&sig_bytes))
                    .is_ok(),
                Err(_) => false,
            },
            Err(_) => false,
        }
    }
}
