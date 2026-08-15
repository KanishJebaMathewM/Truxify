use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use truxify_zkp_verifier::bulletproofs::{
    BulletproofInput, BulletproofResult, BulletproofsGenerator,
};

const TEST_SIGNING_SEED: [u8; 32] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];

fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&TEST_SIGNING_SEED)
}

fn verifying_key() -> VerifyingKey {
    signing_key().verifying_key()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_bulletproof_range() {
        let input = BulletproofInput {
            weight_kg: 14500,
            max_limit_kg: 16200,
            blinding_factor: "secret_blind_123".to_string(),
        };

        let res = BulletproofsGenerator::prove_weight_range(&input, &signing_key());
        assert!(res.is_in_range);
        assert!(BulletproofsGenerator::verify_range_proof(
            &res, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_invalid_overweight_bulletproof() {
        let input = BulletproofInput {
            weight_kg: 19000, // Over limit
            max_limit_kg: 16200,
            blinding_factor: "secret_blind_456".to_string(),
        };

        let res = BulletproofsGenerator::prove_weight_range(&input, &signing_key());
        assert!(!res.is_in_range);
        assert!(!BulletproofsGenerator::verify_range_proof(
            &res, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_forged_proof_with_false_in_range_flag_is_rejected() {
        // A malicious prover claims is_in_range = true while encoding an over-limit weight.
        // The verifier must derive in_range itself and reject the forged proof.
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "0xbproof_4a38_7365637265745f626c696e645f3939".to_string(), // 0x4a38 = 19000
            commitment_hex: "0xcomm_4a38_secret_blind_99".to_string(),
            signature_hex: hex::encode([0u8; 64]),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(
            &forged, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_inconsistent_proof_and_commitment_is_rejected() {
        // The proof and commitment disagree on the claimed weight; this must be rejected
        // rather than trusting the prover-supplied flag.
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "0xbproof_38a4_7365637265745f626c696e645f3939".to_string(), // 0x38a4 = 14500
            commitment_hex: "0xcomm_4a38_secret_blind_99".to_string(), // 0x4a38 = 19000
            signature_hex: hex::encode([0u8; 64]),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(
            &forged, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_self_asserted_in_range_weight_without_signature_is_rejected() {
        // The core vulnerability: a prover encodes an arbitrary in-range weight
        // (here 5000 <= 16200) but supplies no valid device signature. The
        // verifier must reject it because the weight is not cryptographically
        // bound to the device key.
        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: "0xbproof_1388_7365637265745f626c696e645f3939".to_string(), // 0x1388 = 5000
            commitment_hex: "0xcomm_1388_secret_blind_99".to_string(),
            signature_hex: hex::encode([0u8; 64]),
        };
        assert!(!BulletproofsGenerator::verify_range_proof(
            &forged, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_forged_signature_from_wrong_key_is_rejected() {
        // A genuine-looking claim signed by an attacker's key (not the device
        // key) must be rejected, even when the encoded weight is in range.
        let weight: u64 = 14500;
        let blinding = "secret_blind_123".to_string();
        let proof = format!("0xbproof_{:x}_{}", weight, hex::encode(&blinding));
        let commitment = format!("0xcomm_{:x}_{}", weight, blinding);

        // Sign with a key that is NOT the device key, then reuse only the signature.
        let attacker_key = SigningKey::from_bytes(&[0xaa; 32]);
        let signature_hex = BulletproofsGenerator::prove_weight_range(
            &BulletproofInput {
                weight_kg: weight,
                max_limit_kg: 16200,
                blinding_factor: "secret_blind_123".to_string(),
            },
            &attacker_key,
        )
        .signature_hex;

        let forged = BulletproofResult {
            is_in_range: true,
            proof_bytes_hex: proof,
            commitment_hex: commitment,
            signature_hex,
        };
        assert!(!BulletproofsGenerator::verify_range_proof(
            &forged, 16200, &verifying_key()
        ));
    }

    #[test]
    fn test_tampered_weight_after_signing_is_rejected() {
        // Even a device-signed proof must fail if the weight is altered after
        // signing, proving the signature actually binds the weight.
        let input = BulletproofInput {
            weight_kg: 14500,
            max_limit_kg: 16200,
            blinding_factor: "secret_blind_123".to_string(),
        };
        let mut res = BulletproofsGenerator::prove_weight_range(&input, &signing_key());
        // Attacker changes the encoded weight to a smaller in-range value.
        res.proof_bytes_hex = "0xbproof_1388_7365637265745f626c696e645f3939".to_string(); // 5000
        res.commitment_hex = "0xcomm_1388_secret_blind_123".to_string();
        assert!(!BulletproofsGenerator::verify_range_proof(
            &res, 16200, &verifying_key()
        ));
    }
}
