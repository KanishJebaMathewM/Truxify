use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use truxify_zkp_verifier::verifier::ZkWeightVerifier;
use truxify_zkp_verifier::weight_proof::{now_seconds, WeightProofGenerator, WeightProofInput};

/// Test-only signing key whose public half is used by the verifier in these
/// tests. In production the secret key lives only with the weighing device.
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

fn input(axle_weight_kg: u64, max_legal_limit_kg: u64, nonce: &str) -> WeightProofInput {
    WeightProofInput {
        axle_weight_kg,
        max_legal_limit_kg,
        nonce: nonce.to_string(),
    }
}

#[test]
fn test_valid_weight_proof() {
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_123"),
        &signing_key(),
    );

    assert!(ZkWeightVerifier::verify_proof(&proof, 16200, &verifying_key(), now_seconds()));
}

#[test]
fn test_overweight_proof_rejection() {
    // A correctly signed claim that is overweight relative to the VERIFIER's
    // limit must still be rejected: validity is decided by the verifier, not
    // by the device's own is_valid flag.
    let proof = WeightProofGenerator::generate_proof(
        &input(18500, 16200, "nonce_test_456"),
        &signing_key(),
    );

    assert!(!ZkWeightVerifier::verify_proof(&proof, 16200, &verifying_key(), now_seconds()));
}

#[test]
fn test_forged_proof_rejected() {
    // A signature produced with a different secret key must not verify.
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_789"),
        &signing_key(),
    );
    let attacker_key = SigningKey::from_bytes(&[0xaa; 32]);

    assert!(!ZkWeightVerifier::verify_proof(
        &proof,
        16200,
        &attacker_key.verifying_key(),
        now_seconds(),
    ));
}

#[test]
fn test_tampered_weight_rejected() {
    // The signature binds the axle weight: tampering with it after signing
    // must invalidate the proof even though the forged weight is within limit.
    let mut proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_135"),
        &signing_key(),
    );
    proof.axle_weight_kg = 14001;

    assert!(!ZkWeightVerifier::verify_proof(&proof, 16200, &verifying_key(), now_seconds()));
}

#[test]
fn test_future_timestamp_rejected() {
    // Proofs stamped beyond the allowed clock skew must be rejected so a
    // captured signature cannot be replayed forever.
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_246"),
        &signing_key(),
    );
    let now = now_seconds();

    assert!(!ZkWeightVerifier::verify_proof(&proof, 16200, &verifying_key(), now + 1_000_000));
}

#[test]
fn test_stale_timestamp_rejected() {
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_358"),
        &signing_key(),
    );
    let now = now_seconds();

    assert!(!ZkWeightVerifier::verify_proof(&proof, 16200, &verifying_key(), now - 1_000_000));
}
