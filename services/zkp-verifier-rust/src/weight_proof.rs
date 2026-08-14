use ed25519_dalek::{Signer, SigningKey};
use serde::{Deserialize, Serialize};
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WeightProofInput {
    pub axle_weight_kg: u64,
    pub max_legal_limit_kg: u64,
    pub nonce: String,
}

/// A weight claim signed by the weighing device. There is intentionally NO
/// `is_valid` flag and no self-declared "proof hash": validity is decided by
/// the verifier, which independently compares the claimed axle weight against
/// its own `max_allowed_limit` and cryptographically verifies the signature.
#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct WeightProofOutput {
    pub axle_weight_kg: u64,
    pub max_legal_limit_kg: u64,
    pub nonce: String,
    pub timestamp: u64,
    pub signature_hex: String,
}

/// Canonically encodes the claim (weight, device limit, nonce, timestamp) so
/// the signed commitment is unambiguous and the verifier can re-derive exactly
/// the bytes that were signed. Length-prefixing the nonce prevents collisions
/// between different field combinations.
pub fn canonical_payload(
    axle_weight_kg: u64,
    max_legal_limit_kg: u64,
    nonce: &str,
    timestamp: u64,
) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"truxify.zkp.weight.v1");
    out.extend_from_slice(&axle_weight_kg.to_be_bytes());
    out.extend_from_slice(&max_legal_limit_kg.to_be_bytes());
    out.extend_from_slice(&timestamp.to_be_bytes());
    out.extend_from_slice(&(nonce.len() as u64).to_be_bytes());
    out.extend_from_slice(nonce.as_bytes());
    out
}

/// Current Unix time in seconds. The timestamp is real and monotonic (not the
/// previous hardcoded constant) so the verifier can enforce freshness.
pub fn now_seconds() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub struct WeightProofGenerator;

impl WeightProofGenerator {
    /// Signs the weight claim with the device-held Ed25519 secret key. Only the
    /// weighing device possesses the key, so a client that reads the (public)
    /// verifier binary cannot fabricate a claim. The timestamp is captured at
    /// generation time and is part of the signed payload.
    pub fn generate_proof(
        input: &WeightProofInput,
        signing_key: &SigningKey,
    ) -> WeightProofOutput {
        let timestamp = now_seconds();
        let payload = canonical_payload(
            input.axle_weight_kg,
            input.max_legal_limit_kg,
            &input.nonce,
            timestamp,
        );
        let signature = signing_key.sign(&payload);

        WeightProofOutput {
            axle_weight_kg: input.axle_weight_kg,
            max_legal_limit_kg: input.max_legal_limit_kg,
            nonce: input.nonce.clone(),
            timestamp,
            signature_hex: hex::encode(signature.to_bytes()),
        }
    }
}
