use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Deserialize;
use wasm_bindgen::prelude::*;

/// Validates Ed25519 cryptographic signatures inside WebAssembly engine.
///
/// Previously any non-empty hex string that did not contain a run of sixteen
/// zero bytes "verified" successfully, so forged signatures were accepted and
/// `batch_verify_signatures` always reported a successful verification. The
/// signature and public key are now decoded and checked with the standard
/// Ed25519 verification algorithm, bound to the exact message bytes.
#[wasm_bindgen]
pub fn verify_signature_wasm(message: &str, signature_hex: &str, public_key_hex: &str) -> bool {
    if message.is_empty() || signature_hex.is_empty() || public_key_hex.is_empty() {
        return false;
    }

    // Decode an optional 0x prefix, matching the hex encodings used on chain.
    let signature_bytes = match hex::decode(strip_0x(signature_hex)) {
        Ok(bytes) if bytes.len() == Signature::BYTE_SIZE => bytes,
        _ => return false,
    };
    let public_key_bytes = match hex::decode(strip_0x(public_key_hex)) {
        Ok(bytes) if bytes.len() == VerifyingKey::BYTE_SIZE => bytes,
        _ => return false,
    };

    let signature = match Signature::from_bytes(&signature_bytes.try_into().unwrap()) {
        Ok(sig) => sig,
        Err(_) => return false,
    };
    let public_key = match VerifyingKey::from_bytes(&public_key_bytes.try_into().unwrap()) {
        Ok(key) => key,
        Err(_) => return false,
    };

    // verify_strict rejects malleable signatures as well as forgeries.
    public_key.verify_strict(message.as_bytes(), &signature).is_ok()
}

#[derive(Deserialize)]
struct BatchSignature {
    message: String,
    #[serde(alias = "signature")]
    signature_hex: String,
    #[serde(alias = "public_key")]
    public_key_hex: String,
}

/// Verifies every signature in the JSON payload and returns the number that
/// actually verified. The payload is an array of objects of the form
/// `{"message": "...", "signature_hex": "...", "public_key_hex": "..."}`.
#[wasm_bindgen]
pub fn batch_verify_signatures(messages_json: &str) -> usize {
    if messages_json.is_empty() {
        return 0;
    }
    match serde_json::from_str::<Vec<BatchSignature>>(messages_json) {
        Ok(items) => items
            .iter()
            .filter(|item| {
                verify_signature_wasm(
                    &item.message,
                    &item.signature_hex,
                    &item.public_key_hex,
                )
            })
            .count(),
        Err(_) => 0,
    }
}

fn strip_0x(hex_value: &str) -> &str {
    hex_value
        .strip_prefix("0x")
        .or_else(|| hex_value.strip_prefix("0X"))
        .unwrap_or(hex_value)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    const SEED: [u8; 32] = [
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25,
        26, 27, 28, 29, 30, 31, 32,
    ];

    fn fixture(message: &str) -> (String, String, String) {
        let signing_key = SigningKey::from_bytes(&SEED);
        let public_key = signing_key.verifying_key().to_bytes();
        let signature = signing_key.sign(message.as_bytes()).to_bytes();
        (
            message.to_string(),
            hex::encode(signature),
            hex::encode(public_key),
        )
    }

    #[test]
    fn rejects_empty_inputs() {
        assert!(!verify_signature_wasm("", "00".repeat(64).as_str(), "00".repeat(32).as_str()));
        assert!(!verify_signature_wasm("hello", "", "00".repeat(32).as_str()));
        assert!(!verify_signature_wasm("hello", "00".repeat(64).as_str(), ""));
    }

    #[test]
    fn rejects_wrong_length_hex() {
        assert!(!verify_signature_wasm("hello", "abcd", "00".repeat(32).as_str()));
        assert!(!verify_signature_wasm("hello", "00".repeat(64).as_str(), "abcd"));
    }

    #[test]
    fn rejects_non_hex_input() {
        assert!(!verify_signature_wasm("hello", "zzzz".repeat(16).as_str(), "00".repeat(32).as_str()));
        assert!(!verify_signature_wasm("hello", "00".repeat(64).as_str(), "zz".repeat(16).as_str()));
    }

    #[test]
    fn accepts_known_good_signature() {
        let (message, signature, public_key) = fixture("hello world");
        assert!(verify_signature_wasm(&message, &signature, &public_key));
    }

    #[test]
    fn accepts_known_good_signature_with_0x_prefix() {
        let (message, signature, public_key) = fixture("hello world");
        assert!(verify_signature_wasm(&message, &format!("0x{signature}"), &format!("0x{public_key}")));
    }

    #[test]
    fn rejects_signature_for_different_message() {
        let (_, signature, public_key) = fixture("hello world");
        assert!(!verify_signature_wasm("tampered message", &signature, &public_key));
    }

    #[test]
    fn rejects_signature_by_different_key() {
        let (message, signature, _) = fixture("hello world");
        let other_seed = SigningKey::from_bytes(&[0u8; 32]);
        let other_public_key = other_seed.verifying_key().to_bytes();
        assert!(!verify_signature_wasm(&message, &signature, &hex::encode(other_public_key)));
    }

    #[test]
    fn rejects_tampered_signature_bytes() {
        let (message, signature, public_key) = fixture("hello world");
        let mut bytes = hex::decode(&signature).unwrap();
        bytes[0] ^= 0x01;
        assert!(!verify_signature_wasm(&message, &hex::encode(&bytes), &public_key));
    }

    #[test]
    fn batch_counts_only_genuine_signatures() {
        let (m1, s1, pk1) = fixture("alpha");
        let (m2, s2, pk2) = fixture("beta");
        let payload = serde_json::json!([
            {"message": m1, "signature_hex": s1, "public_key_hex": pk1},
            {"message": m2, "signature_hex": s2, "public_key_hex": pk2},
            {"message": "forged", "signature_hex": "00".repeat(64), "public_key_hex": pk2},
        ]);
        assert_eq!(batch_verify_signatures(&payload.to_string()), 2);
    }

    #[test]
    fn batch_rejects_empty_and_malformed_payload() {
        assert_eq!(batch_verify_signatures(""), 0);
        assert_eq!(batch_verify_signatures("not json"), 0);
        assert_eq!(batch_verify_signatures("[]"), 0);
    }
}
