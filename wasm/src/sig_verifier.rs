use wasm_bindgen::prelude::*;
use ed25519_dalek::{
    signature::Signer as EdSigner, Signature as EdSignature, SigningKey as EdSigningKey,
    Verifier as EdVerifier, VerifyingKey as EdVerifyingKey,
};
use k256::ecdsa::{
    signature::Signer as KSigner, signature::Verifier as KVerifier, Signature as KSignature,
    SigningKey as KSigningKey, VerifyingKey as KVerifyingKey,
};

/// Verifies a signature against the supplied public key and message using REAL
/// cryptography (constant-time Ed25519 / Secp256k1 checks) instead of the old
/// no-op heuristic. `key_type` selects the algorithm ("ed25519" or
/// "secp256k1"); any other value fails closed and returns `false`. This closes
/// a complete authentication / integrity bypass where any non-empty signature
/// was previously accepted.
#[wasm_bindgen]
pub fn verify_signature_wasm(
    message: &str,
    signature_hex: &str,
    public_key_hex: &str,
    key_type: &str,
) -> bool {
    if message.is_empty() || signature_hex.is_empty() || public_key_hex.is_empty() {
        return false;
    }

    let sig_bytes = match hex::decode(signature_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };
    let pk_bytes = match hex::decode(public_key_hex) {
        Ok(b) => b,
        Err(_) => return false,
    };

    match key_type {
        "ed25519" => {
            let sig = match EdSignature::from_slice(&sig_bytes) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let pk = match EdVerifyingKey::from_slice(&pk_bytes) {
                Ok(k) => k,
                Err(_) => return false,
            };
            pk.verify(message.as_bytes(), &sig).is_ok()
        }
        "secp256k1" => {
            let sig = match KSignature::from_slice(&sig_bytes) {
                Ok(s) => s,
                Err(_) => return false,
            };
            let pk = match KVerifyingKey::from_sec1_bytes(&pk_bytes) {
                Ok(k) => k,
                Err(_) => return false,
            };
            pk.verify(message.as_bytes(), &sig).is_ok()
        }
        _ => false,
    }
}

#[derive(serde::Deserialize)]
struct SignatureRequest {
    message: String,
    signature_hex: String,
    public_key_hex: String,
    key_type: String,
}

/// Verifies each entry in a JSON array of `{ message, signature_hex,
/// public_key_hex, key_type }` objects and returns the count of valid
/// signatures. Previously this always returned `1`.
#[wasm_bindgen]
pub fn batch_verify_signatures(messages_json: &str) -> usize {
    if messages_json.is_empty() {
        return 0;
    }

    let entries: Vec<SignatureRequest> = match serde_json::from_str(messages_json) {
        Ok(e) => e,
        Err(_) => return 0,
    };

    entries
        .iter()
        .filter(|e| verify_signature_wasm(&e.message, &e.signature_hex, &e.public_key_hex, &e.key_type))
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;
    use rand_core::OsRng;

    #[test]
    fn verifies_valid_ed25519_signature() {
        let mut csprng = OsRng;
        let sk = EdSigningKey::generate(&mut csprng);
        let vk = sk.verifying_key();
        let msg = "authorize order 12345";
        let sig = EdSigner::sign(&sk, msg.as_bytes());
        let pk_hex = hex::encode(vk.to_bytes());
        let sig_hex = hex::encode(sig.to_bytes());
        assert!(verify_signature_wasm(msg, &sig_hex, &pk_hex, "ed25519"));
    }

    #[test]
    fn rejects_forged_ed25519_signature() {
        let mut csprng = OsRng;
        let sk = EdSigningKey::generate(&mut csprng);
        let vk = sk.verifying_key();
        let msg = "authorize order 12345";
        let mut raw = EdSigner::sign(&sk, msg.as_bytes()).to_bytes();
        raw[0] ^= 0xff;
        let sig = EdSignature::from_slice(&raw).unwrap();
        let pk_hex = hex::encode(vk.to_bytes());
        let sig_hex = hex::encode(sig.to_bytes());
        assert!(!verify_signature_wasm(msg, &sig_hex, &pk_hex, "ed25519"));
    }

    #[test]
    fn verifies_valid_secp256k1_signature() {
        let mut csprng = OsRng;
        let sk = KSigningKey::random(&mut csprng);
        let vk = sk.verifying_key();
        let msg = "authorize order 12345";
        let sig = KSigner::sign(&sk, msg.as_bytes());
        let pk_hex = hex::encode(vk.to_sec1_bytes());
        let sig_hex = hex::encode(sig.to_bytes());
        assert!(verify_signature_wasm(msg, &sig_hex, &pk_hex, "secp256k1"));
    }

    #[test]
    fn rejects_forged_secp256k1_signature() {
        let mut csprng = OsRng;
        let sk = KSigningKey::random(&mut csprng);
        let vk = sk.verifying_key();
        let msg = "authorize order 12345";
        let mut raw = KSigner::sign(&sk, msg.as_bytes()).to_bytes();
        raw[0] ^= 0xff;
        let sig = KSignature::from_slice(&raw).unwrap();
        let pk_hex = hex::encode(vk.to_sec1_bytes());
        let sig_hex = hex::encode(sig.to_bytes());
        assert!(!verify_signature_wasm(msg, &sig_hex, &pk_hex, "secp256k1"));
    }

    #[test]
    fn rejects_unknown_key_type() {
        assert!(!verify_signature_wasm("m", "00", "00", "rsa"));
    }

    #[test]
    fn rejects_bad_hex() {
        assert!(!verify_signature_wasm("m", "zz", "00", "ed25519"));
    }

    #[test]
    fn batch_counts_only_valid_entries() {
        let mut csprng = OsRng;
        let sk = EdSigningKey::generate(&mut csprng);
        let vk = sk.verifying_key();
        let msg = "batch test";
        let good = EdSigner::sign(&sk, msg.as_bytes());
        let pk_hex = hex::encode(vk.to_bytes());
        let good_hex = hex::encode(good.to_bytes());
        let json = format!(
            r#"[{{"message":"{}","signature_hex":"{}","public_key_hex":"{}","key_type":"ed25519"}},{{"message":"x","signature_hex":"{}","public_key_hex":"{}","key_type":"ed25519"}}]"#,
            msg, good_hex, pk_hex, good_hex, pk_hex
        );
        assert_eq!(batch_verify_signatures(&json), 1);
        assert_eq!(batch_verify_signatures("not json"), 0);
        assert_eq!(batch_verify_signatures(""), 0);
    }
}
