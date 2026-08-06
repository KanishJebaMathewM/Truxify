use ed25519_dalek::{Signature, VerifyingKey};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::OnceLock;
use std::time::Instant;

/// Dev-only Ed25519 verifying public key (hex-encoded).
///
/// A verification key is public material: it is safe to ship inside the
/// verifier because Ed25519 public keys cannot be used to forge signatures.
/// The matching private key lives only with the proving side. Production
/// deployments MUST override this value with `TRUXIFY_ZKP_VERIFYING_PUBLIC_KEY`
/// and provision the prover with the corresponding private key out of band.
const DEFAULT_VERIFYING_PUBLIC_KEY_HEX: &str =
    "03a107bff3ce10be1d70dd18e74bc09967e4d6309ba50d5f1ddc8664125531b8";

/// The verifier never holds the private key. It only knows the verification
/// (public) key, so a client that reads this binary cannot fabricate a valid
/// proof: a valid proof is an Ed25519 signature that only the prover's private
/// key can produce.
static VERIFYING_KEY: OnceLock<VerifyingKey> = OnceLock::new();

/// Loads the Ed25519 verification key from the environment (or the dev
/// default). Parsed once and cached.
fn verifying_key() -> &'static VerifyingKey {
    VERIFYING_KEY.get_or_init(|| {
        let hex_str = std::env::var("TRUXIFY_ZKP_VERIFYING_PUBLIC_KEY")
            .unwrap_or_else(|_| DEFAULT_VERIFYING_PUBLIC_KEY_HEX.to_string());
        let bytes = hex::decode(hex_str.trim())
            .expect("TRUXIFY_ZKP_VERIFYING_PUBLIC_KEY must be valid hex");
        let arr: [u8; 32] = bytes
            .try_into()
            .expect("TRUXIFY_ZKP_VERIFYING_PUBLIC_KEY must be exactly 32 bytes");
        VerifyingKey::from_bytes(&arr)
            .expect("TRUXIFY_ZKP_VERIFYING_PUBLIC_KEY must be a valid Ed25519 public key")
    })
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ZKPProofRequest {
    pub proof_id: String,
    pub proof_type: String, // "identity_kyc", "proof_of_funds", "geofence_location"
    pub public_inputs: Vec<String>,
    pub proof_bytes_hex: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ZKPVerificationResult {
    pub proof_id: String,
    pub verified: bool,
    pub proof_type: String,
    pub verification_time_micros: u128,
    pub circuit_hash: String,
    pub status: String,
}

/// Canonically encodes the public statement (proof type + public inputs) so the
/// signed commitment is unambiguous: a length-prefixed encoding of the inputs
/// prevents collisions between different input combinations.
fn canonical_statement(proof_type: &str, public_inputs: &[String]) -> Vec<u8> {
    let mut out = Vec::new();
    let tag = format!("truxify.zkp.v1.{proof_type}");
    out.extend_from_slice(tag.as_bytes());
    for input in public_inputs {
        out.extend_from_slice(&(input.len() as u64).to_be_bytes());
        out.extend_from_slice(input.as_bytes());
    }
    out
}

pub fn verify_zkp_circuit(req: &ZKPProofRequest) -> ZKPVerificationResult {
    let start = Instant::now();

    // A proof is a 64-byte Ed25519 signature over the canonical statement,
    // hex-encoded. Because only the prover holds the private key, the public
    // verification key cannot be used to generate valid proofs. Garbage,
    // empty, odd-length, wrong-size, and forged proofs are all rejected.
    let statement = canonical_statement(&req.proof_type, &req.public_inputs);
    let is_verified = match hex::decode(&req.proof_bytes_hex) {
        Ok(proof_bytes) => match <[u8; 64]>::try_from(proof_bytes.as_slice()) {
            Ok(sig_bytes) => verifying_key()
                .verify_strict(&statement, &Signature::from_bytes(&sig_bytes))
                .is_ok(),
            Err(_) => false,
        },
        Err(_) => false,
    };

    let circuit_hash = hex::encode(Sha256::digest(&statement));

    let duration = start.elapsed().as_micros();

    ZKPVerificationResult {
        proof_id: req.proof_id.clone(),
        verified: is_verified,
        proof_type: req.proof_type.clone(),
        verification_time_micros: duration,
        circuit_hash,
        status: if is_verified {
            "VALID_PROOF"
        } else {
            "INVALID_PROOF"
        }
        .to_string(),
    }
}

fn main() {
    println!("🔐 Truxify Rust Zero-Knowledge Proof (ZKP) Verifier starting...");

    // An attacker that only knows the public verification key cannot forge a
    // proof. A client-supplied 64-byte "proof" (here all zero bytes) must be
    // rejected by the verifier.
    let forged_req = ZKPProofRequest {
        proof_id: "zkp_forged_sample".to_string(),
        proof_type: "identity_kyc".to_string(),
        public_inputs: vec!["driver_hash_99".to_string(), "min_rating_4_5".to_string()],
        proof_bytes_hex: hex::encode([0u8; 64]),
    };

    let res = verify_zkp_circuit(&forged_req);
    println!("Forged proof result: {:?}", res);
    assert!(!res.verified, "forged proof must never verify");
    println!("ZKP Verifier ready for deployment.");
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    /// Test-only signing key whose public half matches the default verifying
    /// public key. Never shipped with the verifier in production.
    const TEST_SIGNING_SEED: [u8; 32] = [
        0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f,
        0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f,
    ];

    fn request(
        proof_type: &str,
        public_inputs: &[&str],
        proof_bytes_hex: &str,
    ) -> ZKPProofRequest {
        ZKPProofRequest {
            proof_id: "zkp_test".to_string(),
            proof_type: proof_type.to_string(),
            public_inputs: public_inputs.iter().map(|s| s.to_string()).collect(),
            proof_bytes_hex: proof_bytes_hex.to_string(),
        }
    }

    fn genuine_proof(proof_type: &str, public_inputs: &[&str]) -> String {
        let inputs: Vec<String> = public_inputs.iter().map(|s| s.to_string()).collect();
        let statement = canonical_statement(proof_type, &inputs);
        let signing_key = SigningKey::from_bytes(&TEST_SIGNING_SEED);
        hex::encode(signing_key.sign(&statement).to_bytes())
    }

    #[test]
    fn rejects_empty_proof() {
        let req = request("identity_kyc", &["driver_hash_99"], "");
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn rejects_non_hex_proof() {
        let req = request("identity_kyc", &["driver_hash_99"], "zzzz-not-hex");
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn rejects_odd_length_hex_proof() {
        let req = request("identity_kyc", &["driver_hash_99"], "4a8f9b2c1d3e5");
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn rejects_garbage_hex_proof() {
        // 7 bytes: decodes to hex but is not a 64-byte signature.
        let req = request("identity_kyc", &["driver_hash_99"], "4a8f9b2c1d3e5f");
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn rejects_all_zero_signature() {
        let req = request("identity_kyc", &["driver_hash_99"], &hex::encode([0u8; 64]));
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn accepts_genuine_proof() {
        let req = request(
            "identity_kyc",
            &["driver_hash_99", "min_rating_4_5"],
            &genuine_proof("identity_kyc", &["driver_hash_99", "min_rating_4_5"]),
        );
        let res = verify_zkp_circuit(&req);
        assert!(res.verified);
        assert_eq!(res.status, "VALID_PROOF");
    }

    #[test]
    fn proof_is_bound_to_public_inputs() {
        // A genuine proof for inputs A must not verify inputs B.
        let proof = genuine_proof("identity_kyc", &["driver_hash_99"]);
        let req = request("identity_kyc", &["driver_hash_98"], &proof);
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn proof_is_bound_to_proof_type() {
        // A genuine proof for identity_kyc must not verify as proof_of_funds.
        let proof = genuine_proof("identity_kyc", &["driver_hash_99"]);
        let req = request("proof_of_funds", &["driver_hash_99"], &proof);
        let res = verify_zkp_circuit(&req);
        assert!(!res.verified);
        assert_eq!(res.status, "INVALID_PROOF");
    }

    #[test]
    fn cannot_forge_with_public_key_only() {
        // An attacker who knows only the public verification key (i.e. the
        // entire shipped verifier binary) must not be able to produce a proof.
        for forged in [
            hex::encode([0u8; 64]),
            hex::encode(Sha256::digest(canonical_statement(
                "identity_kyc",
                &["driver_hash_99".to_string()],
            ))),
            hex::encode(canonical_statement(
                "identity_kyc",
                &["driver_hash_99".to_string()],
            )),
        ] {
            let req = request("identity_kyc", &["driver_hash_99"], &forged);
            let res = verify_zkp_circuit(&req);
            assert!(!res.verified, "forgery accepted: {forged}");
            assert_eq!(res.status, "INVALID_PROOF");
        }
    }
}
