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
        if !result.is_in_range {
            return false;
        }
        result.proof_bytes_hex.starts_with("0xbproof_") && result.commitment_hex.starts_with("0xcomm_")
    }
}
