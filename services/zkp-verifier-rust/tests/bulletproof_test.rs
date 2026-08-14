#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_bulletproof_range() {
        let input = bulletproofs::BulletproofInput {
            weight_kg: 14500,
            max_limit_kg: 16200,
            blinding_factor: "secret_blind_123".to_string(),
        };

        let res = bulletproofs::BulletproofsGenerator::prove_weight_range(&input);
        assert!(res.is_in_range);
        assert!(bulletproofs::BulletproofsGenerator::verify_range_proof(&res, 16200));
    }

    #[test]
    fn test_invalid_overweight_bulletproof() {
        let input = bulletproofs::BulletproofInput {
            weight_kg: 19000, // Over limit
            max_limit_kg: 16200,
            blinding_factor: "secret_blind_456".to_string(),
        };

        let res = bulletproofs::BulletproofsGenerator::prove_weight_range(&input);
        assert!(!res.is_in_range);
        assert!(!bulletproofs::BulletproofsGenerator::verify_range_proof(&res, 16200));
    }

    #[test]
    fn test_forged_proof_with_false_in_range_flag_is_rejected() {
        // A malicious prover claims is_in_range = true while encoding an over-limit weight.
        // The verifier must derive in_range itself and reject the forged proof.
        let forged = bulletproofs::BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "0xbproof_4a38_7365637265745f626c696e645f3939".to_string(), // 0x4a38 = 19000
            commitment_hex: "0xcomm_4a38_secret_blind_99".to_string(),
        };
        assert!(!bulletproofs::BulletproofsGenerator::verify_range_proof(&forged, 16200));
    }

    #[test]
    fn test_inconsistent_proof_and_commitment_is_rejected() {
        // The proof and commitment disagree on the claimed weight; this must be rejected
        // rather than trusting the prover-supplied flag.
        let forged = bulletproofs::BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "0xbproof_38a4_7365637265745f626c696e645f3939".to_string(), // 0x38a4 = 14500
            commitment_hex: "0xcomm_4a38_secret_blind_99".to_string(), // 0x4a38 = 19000
        };
        assert!(!bulletproofs::BulletproofsGenerator::verify_range_proof(&forged, 16200));
    }
}
