use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use serde::{Deserialize, Serialize};

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
    /// Ed25519 signature (hex) over the canonical range-claim payload, produced
    /// by the weighing device's secret key. A prover that does not hold the
    /// device key cannot forge a valid signature, so a self-asserted weight is
    /// rejected even when the encoded weight is within the limit.
    pub signature_hex: String,
}

/// Canonically encodes the weight claim (committed weight + blinding factor) so
/// the signed commitment is unambiguous. The verifier reconstructs exactly
/// these bytes and verifies the device signature over them.
fn canonical_range_payload(weight: u64, blinding: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    out.extend_from_slice(b"truxify.zkp.range.v1");
    out.extend_from_slice(&weight.to_be_bytes());
    out.extend_from_slice(&(blinding.len() as u64).to_be_bytes());
    out.extend_from_slice(blinding);
    out
}

pub struct BulletproofsGenerator;

impl BulletproofsGenerator {
    /// Produces a range proof that is cryptographically bound to the device's
    /// Ed25519 secret key. Only the weighing device holds this key, so an
    /// attacker reading the (public) verifier binary cannot fabricate a proof.
    pub fn prove_weight_range(input: &BulletproofInput, signing_key: &SigningKey) -> BulletproofResult {
        let is_in_range = input.weight_kg <= input.max_limit_kg;
        let commitment = format!("0xcomm_{:x}_{}", input.weight_kg, input.blinding_factor);
        let proof = format!("0xbproof_{:x}_{}", input.weight_kg, hex::encode(&input.blinding_factor));

        let payload = canonical_range_payload(input.weight_kg, input.blinding_factor.as_bytes());
        let signature = signing_key.sign(&payload);

        BulletproofResult {
            is_in_range,
            proof_bytes_hex: proof,
            commitment_hex: commitment,
            signature_hex: hex::encode(signature.to_bytes()),
        }
    }

    /// Verifies a range proof. SECURITY: the claimed weight is never trusted on
    /// its own -- it is only accepted when it is bound to a valid Ed25519
    /// signature from the device key over the exact (weight, blinding) the proof
    /// encodes. A prover that invents an arbitrary in-range weight cannot
    /// produce a valid signature, so the forged proof is rejected.
    pub fn verify_range_proof(
        result: &BulletproofResult,
        max_allowed: u64,
        verifying_key: &VerifyingKey,
    ) -> bool {
        // SECURITY: never trust the prover-supplied `is_in_range` flag.

        // Expected formats:
        //   proof_bytes_hex = "0xbproof_{weight_hex}_{blinding_hex}"
        //   commitment_hex  = "0xcomm_{weight_hex}_{blinding}"
        let proof_parts: Vec<&str> = result.proof_bytes_hex.split('_').collect();
        let commit_parts: Vec<&str> = result.commitment_hex.split('_').collect();
        if proof_parts.len() != 3 || commit_parts.len() != 3 {
            return false;
        }
        if !proof_parts[0].eq_ignore_ascii_case("0xbproof")
            || !commit_parts[0].eq_ignore_ascii_case("0xcomm")
        {
            return false;
        }

        // Decode the claimed weight from both the proof and commitment; they must agree.
        let proof_weight = match u64::from_str_radix(proof_parts[1], 16) {
            Ok(w) => w,
            Err(_) => return false,
        };
        let commit_weight = match u64::from_str_radix(commit_parts[1], 16) {
            Ok(w) => w,
            Err(_) => return false,
        };
        if proof_weight != commit_weight {
            return false;
        }

        // The blinding factor must be consistent between the proof and the commitment.
        let proof_blinding = match hex::decode(proof_parts[2]) {
            Ok(b) => b,
            Err(_) => return false,
        };
        if proof_blinding != commit_parts[2].as_bytes() {
            return false;
        }

        // Cryptographic binding: the claimed (weight, blinding) must be covered
        // by a valid signature from the device key. Without this, a prover could
        // simply encode any in-range weight and pass the check below.
        let payload = canonical_range_payload(proof_weight, &proof_blinding);
        let sig_bytes = match hex::decode(&result.signature_hex) {
            Ok(b) => match <[u8; 64]>::try_from(b.as_slice()) {
                Ok(arr) => arr,
                Err(_) => return false,
            },
            Err(_) => return false,
        };
        if verifying_key
            .verify_strict(&payload, &ed25519_dalek::Signature::from_bytes(&sig_bytes))
            .is_err()
        {
            return false;
        }

        // Derive `in_range` from the validated, recomputed weight -- not from the prover flag.
        proof_weight <= max_allowed
    }
}
