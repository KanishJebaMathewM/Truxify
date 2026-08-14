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
}
