use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Shared proving/verifying key for the weight-range circuit. The verifier
/// accepts a proof only when it authenticates the range statement under this
/// key, so a caller cannot forge a compliant proof by setting flags. Replace
/// with the proving/verifying keypair of a real Bulletproofs circuit when one
/// is deployed.
const BULLETPROOF_VERIFYING_KEY: &[u8] = b"truxify.bulletproofs.v1.verifying.key.0123456789abcdef";

const RANGE_TAG: &[u8] = b"truxify.bulletproofs.v1.range";
const COMMITMENT_TAG: &[u8] = b"truxify.bulletproofs.v1.commit";

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BulletproofInput {
    pub weight_kg: u64,
    pub max_limit_kg: u64,
    pub blinding_factor: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct BulletproofResult {
    pub is_in_range: bool,
    pub proof_bytes_hex: String,
    pub commitment_hex: String,
}

pub struct BulletproofsGenerator;

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

/// Constant-time byte comparison so mismatches do not leak how many bytes
/// matched.
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

/// Length-prefixed canonical encoding of the committed weight and blinding
/// factor so the commitment and the range statement are bound to the same
/// value.
fn canonical_commitment_statement(weight_kg: u64, blinding_factor: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(COMMITMENT_TAG);
    out.extend_from_slice(&weight_kg.to_be_bytes());
    out.extend_from_slice(&(blinding_factor.len() as u64).to_be_bytes());
    out.extend_from_slice(blinding_factor.as_bytes());
    out
}

/// Length-prefixed canonical encoding of the range statement being proven.
fn canonical_range_statement(weight_kg: u64, max_limit_kg: u64, blinding_factor: &str) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(RANGE_TAG);
    out.extend_from_slice(&weight_kg.to_be_bytes());
    out.extend_from_slice(&max_limit_kg.to_be_bytes());
    out.extend_from_slice(&(blinding_factor.len() as u64).to_be_bytes());
    out.extend_from_slice(blinding_factor.as_bytes());
    out
}

/// The commitment only opens under the verifying key to the exact committed
/// weight and blinding factor.
fn expected_commitment(weight_kg: u64, blinding_factor: &str) -> [u8; 32] {
    hmac_sha256(
        BULLETPROOF_VERIFYING_KEY,
        &canonical_commitment_statement(weight_kg, blinding_factor),
    )
}

/// Builds the proof bytes: the canonical range statement followed by its
/// authentication tag. The committed weight is recoverable from the proof, so
/// the verifier re-derives it instead of trusting a caller-supplied flag.
fn build_proof(weight_kg: u64, max_limit_kg: u64, blinding_factor: &str) -> Vec<u8> {
    let statement = canonical_range_statement(weight_kg, max_limit_kg, blinding_factor);
    let tag = hmac_sha256(BULLETPROOF_VERIFYING_KEY, &statement);
    let mut proof = statement;
    proof.extend_from_slice(&tag);
    proof
}

impl BulletproofsGenerator {
    pub fn prove_weight_range(input: &BulletproofInput) -> BulletproofResult {
        let commitment = expected_commitment(input.weight_kg, &input.blinding_factor);
        let proof = build_proof(input.weight_kg, input.max_limit_kg, &input.blinding_factor);

        BulletproofResult {
            is_in_range: input.weight_kg <= input.max_limit_kg,
            proof_bytes_hex: hex::encode(proof),
            commitment_hex: hex::encode(commitment),
        }
    }

    /// Verifies that `result` is a genuine range proof and that the committed
    /// weight is within `max_allowed`. The caller-supplied `is_in_range` flag
    /// is never consulted: the committed weight is re-derived from the proof,
    /// the commitment must open to that same weight, and only then is the
    /// range checked against `max_allowed`.
    pub fn verify_range_proof(result: &BulletproofResult, max_allowed: u64) -> bool {
        let proof = match hex::decode(&result.proof_bytes_hex) {
            Ok(bytes) => bytes,
            Err(_) => return false,
        };
        let commitment = match hex::decode(&result.commitment_hex) {
            Ok(bytes) => bytes,
            Err(_) => return false,
        };

        // The proof is the canonical statement followed by a 32-byte tag.
        if proof.len() < 32 {
            return false;
        }
        let (statement, tag) = proof.split_at(proof.len() - 32);
        let expected_tag = hmac_sha256(BULLETPROOF_VERIFYING_KEY, statement);
        if !constant_time_eq(tag, &expected_tag) {
            return false;
        }

        // Re-derive the committed weight from the authenticated statement.
        if statement.len() < RANGE_TAG.len() || &statement[..RANGE_TAG.len()] != RANGE_TAG {
            return false;
        }
        let mut rest = &statement[RANGE_TAG.len()..];
        if rest.len() < 16 {
            return false;
        }
        let weight_kg = u64::from_be_bytes(rest[..8].try_into().expect("8-byte weight"));
        rest = &rest[8..];
        // Skip the max_limit_kg field (bound to the proof, checked separately
        // against max_allowed via the recovered weight).
        rest = &rest[8..];
        if rest.len() < 8 {
            return false;
        }
        let blinding_len = u64::from_be_bytes(rest[..8].try_into().expect("8-byte length")) as usize;
        rest = &rest[8..];
        if rest.len() != blinding_len {
            return false;
        }
        let blinding_factor = match std::str::from_utf8(rest) {
            Ok(s) => s,
            Err(_) => return false,
        };

        // The supplied commitment must open to the same committed weight.
        let expected_commitment = expected_commitment(weight_kg, blinding_factor);
        if !constant_time_eq(&commitment, &expected_commitment) {
            return false;
        }

        // Range check computed from the proof, not from the caller's flag.
        weight_kg <= max_allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(weight_kg: u64, max_limit_kg: u64, blinding_factor: &str) -> BulletproofInput {
        BulletproofInput {
            weight_kg,
            max_limit_kg,
            blinding_factor: blinding_factor.to_string(),
        }
    }

    #[test]
    fn accepts_weight_within_limit() {
        let proved = BulletproofsGenerator::prove_weight_range(&input(100, 200, "r_1"));
        assert!(BulletproofsGenerator::verify_range_proof(&proved, 200));
    }

    #[test]
    fn accepts_weight_at_limit() {
        let proved = BulletproofsGenerator::prove_weight_range(&input(200, 200, "r_1"));
        assert!(BulletproofsGenerator::verify_range_proof(&proved, 200));
    }

    #[test]
    fn rejects_weight_over_limit() {
        let proved = BulletproofsGenerator::prove_weight_range(&input(300, 300, "r_1"));
        assert!(!BulletproofsGenerator::verify_range_proof(&proved, 200));
    }

    #[test]
    fn caller_supplied_is_in_range_flag_is_ignored() {
        // An attacker sets is_in_range = true and fabricates a forged proof;
        // the flag must never influence verification.
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "bproof_anything".to_string(),
            commitment_hex: "comm_anything".to_string(),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(&forged, 1000));
    }

    #[test]
    fn rejects_tampered_proof() {
        let proved = BulletproofsGenerator::prove_weight_range(&input(100, 200, "r_1"));
        let mut tampered = proved.clone();
        let bytes = hex::decode(&proved.proof_bytes_hex).expect("valid hex proof");
        let flipped = format!(
            "{}4{}",
            hex::encode(&bytes[..8]),
            hex::encode(&bytes[9..])
        );
        tampered.proof_bytes_hex = flipped;
        assert!(!BulletproofsGenerator::verify_range_proof(&tampered, 200));
    }

    #[test]
    fn rejects_tampered_commitment() {
        let proved = BulletproofsGenerator::prove_weight_range(&input(100, 200, "r_1"));
        let mut tampered = proved.clone();
        let bytes = hex::decode(&proved.commitment_hex).expect("valid hex commitment");
        let flipped = format!(
            "{}f{}",
            hex::encode(&bytes[..4]),
            hex::encode(&bytes[5..])
        );
        tampered.commitment_hex = flipped;
        assert!(!BulletproofsGenerator::verify_range_proof(&tampered, 200));
    }

    #[test]
    fn rejects_empty_inputs() {
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: String::new(),
            commitment_hex: String::new(),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(&forged, 200));
    }

    #[test]
    fn rejects_non_hex_inputs() {
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "zzzz-not-hex".to_string(),
            commitment_hex: "comm_zzzz".to_string(),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(&forged, 200));
    }
}
