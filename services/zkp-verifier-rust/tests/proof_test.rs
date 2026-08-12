use ed25519_dalek::{Signer, SigningKey, VerifyingKey};
use truxify_zkp_verifier::verifier::{ReplayCache, ZkWeightVerifier};
use truxify_zkp_verifier::weight_proof::{
    now_seconds, WeightProofGenerator, WeightProofInput, WeightProofOutput,
};

/// Test-only signing key whose public half is used by the verifier in these
/// tests. In production the secret key lives only with the weighing device.
const TEST_SIGNING_SEED: [u8; 32] = [
    0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
    0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
];

const TEST_VEHICLE_ID: &str = "vehicle_123";

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
        vehicle_id: TEST_VEHICLE_ID.to_string(),
    }
}

fn verify_with(
    proof: &WeightProofOutput,
    max_allowed_limit: u64,
    verifying_key: &VerifyingKey,
    now: u64,
    cache: &ReplayCache,
    binding: &str,
) -> bool {
    ZkWeightVerifier::verify_proof(proof, max_allowed_limit, verifying_key, now, cache, binding)
}

fn verify_at(proof: &WeightProofOutput, now: u64) -> bool {
    verify_with(
        proof,
        16200,
        &verifying_key(),
        now,
        &ReplayCache::new(),
        TEST_VEHICLE_ID,
    )
}

#[test]
fn test_valid_weight_proof() {
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_123"),
        &signing_key(),
    );

    assert!(verify_at(&proof, now_seconds()));
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

    assert!(!verify_at(&proof, now_seconds()));
}

#[test]
fn test_forged_proof_rejected() {
    // A signature produced with a different secret key must not verify.
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_789"),
        &signing_key(),
    );
    let attacker_key = SigningKey::from_bytes(&[0xaa; 32]);

    assert!(!verify_with(
        &proof,
        16200,
        &attacker_key.verifying_key(),
        now_seconds(),
        &ReplayCache::new(),
        TEST_VEHICLE_ID,
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

    assert!(!verify_at(&proof, now_seconds()));
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

    assert!(!verify_at(&proof, now + 1_000_000));
}

#[test]
fn test_stale_timestamp_rejected() {
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_test_358"),
        &signing_key(),
    );
    let now = now_seconds();

    assert!(!verify_at(&proof, now - 1_000_000));
}

#[test]
fn test_proof_replayed_within_window_rejected() {
    // A proof captured at the weigh gate must be usable exactly once: the same
    // nonce replayed within the 300s skew window must be rejected.
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_replay_001"),
        &signing_key(),
    );
    let cache = ReplayCache::new();
    let now = now_seconds();

    // First use: accepted, nonce recorded.
    assert!(verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));

    // Replay within the skew window (same and later timestamps): rejected.
    assert!(!verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
    assert!(!verify_with(
        &proof,
        16200,
        &verifying_key(),
        now + 60,
        &cache,
        TEST_VEHICLE_ID,
    ));
}

#[test]
fn test_fresh_nonce_accepted_after_replay() {
    // Distinct nonces are distinct proofs: after a replay rejection, a fresh
    // nonce for the same vehicle is still accepted.
    let cache = ReplayCache::new();
    let now = now_seconds();

    let proof1 = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_fresh_001"),
        &signing_key(),
    );
    let proof2 = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_fresh_002"),
        &signing_key(),
    );

    assert!(verify_with(
        &proof1,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
    assert!(!verify_with(
        &proof1,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
    assert!(verify_with(
        &proof2,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
}

#[test]
fn test_proof_bound_to_vehicle_binding() {
    // A proof signed for one vehicle/order must not clear a different load,
    // even though the nonce and signature are both valid.
    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_vehicle_001"),
        &signing_key(),
    );
    let cache = ReplayCache::new();
    let now = now_seconds();

    assert!(!verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &cache,
        "vehicle_999",
    ));
    assert!(verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
}

#[test]
fn test_tampered_binding_rejected() {
    // Re-targeting a signed proof at another vehicle must invalidate it: the
    // vehicle_id is part of the signed canonical payload.
    let mut proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_vehicle_002"),
        &signing_key(),
    );
    proof.vehicle_id = "vehicle_999".to_string();

    assert!(!verify_at(&proof, now_seconds()));
}

#[test]
fn test_replay_cache_survives_restart() {
    // Persisting the seen-nonce set closes the window that a restart would
    // otherwise reopen: a proof replayed after a reload is still rejected.
    let cache = ReplayCache::new();
    let now = now_seconds();
    let path = std::env::temp_dir().join("truxify_zkp_replay_cache_test.json");
    let path_str = path.to_string_lossy().to_string();
    let _ = std::fs::remove_file(&path_str);

    let proof = WeightProofGenerator::generate_proof(
        &input(14000, 16200, "nonce_persist_001"),
        &signing_key(),
    );
    assert!(verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &cache,
        TEST_VEHICLE_ID,
    ));
    cache
        .persist(&path_str)
        .expect("replay cache should persist");

    let restored = ReplayCache::load(&path_str);
    assert!(!verify_with(
        &proof,
        16200,
        &verifying_key(),
        now,
        &restored,
        TEST_VEHICLE_ID,
    ));

    let _ = std::fs::remove_file(&path_str);
}
