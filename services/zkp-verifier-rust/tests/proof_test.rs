#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_weight_proof() {
        let input = weight_proof::WeightProofInput {
            axle_weight_kg: 14000,
            max_legal_limit_kg: 16200,
            nonce: "nonce_test_123".to_string(),
        };

        let proof = weight_proof::WeightProofGenerator::generate_proof(&input);
        assert!(proof.is_valid);
        assert!(verifier::ZkWeightVerifier::verify_proof(&proof, 16200));
    }

    #[test]
    fn test_overweight_proof_rejection() {
        let input = weight_proof::WeightProofInput {
            axle_weight_kg: 18500, // Overweight
            max_legal_limit_kg: 16200,
            nonce: "nonce_test_456".to_string(),
        };

        let proof = weight_proof::WeightProofGenerator::generate_proof(&input);
        assert!(!proof.is_valid);
        assert!(!verifier::ZkWeightVerifier::verify_proof(&proof, 16200));
    }
}
