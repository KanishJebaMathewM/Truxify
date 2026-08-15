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
}

pub struct BulletproofsGenerator;

impl BulletproofsGenerator {
    pub fn prove_weight_range(input: &BulletproofInput) -> BulletproofResult {
        let is_in_range = input.weight_kg <= input.max_limit_kg;
        let commitment = format!("0xcomm_{:x}_{}", input.weight_kg, input.blinding_factor);
        let proof = format!("0xbproof_{:x}_{}", input.weight_kg, hex::encode(&input.blinding_factor));

        BulletproofResult {
            is_in_range,
            proof_bytes_hex: proof,
            commitment_hex: commitment,
        }
    }

    pub fn verify_range_proof(result: &BulletproofResult, max_allowed: u64) -> bool {
        // SECURITY: never trust the prover-supplied `is_in_range` flag.
        // Recompute the claimed weight and blinding from the proof and commitment,
        // confirm they are mutually consistent, then derive `in_range` ourselves.

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

        // Derive `in_range` from the validated, recomputed weight -- not from the prover flag.
        proof_weight <= max_allowed
    }
}
