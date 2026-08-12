use crate::weight_proof::{canonical_payload, now_seconds, WeightProofOutput};
use ed25519_dalek::{Signature, VerifyingKey};
use std::collections::HashMap;
use std::sync::Mutex;

/// Maximum allowed skew (seconds) between the device timestamp and the
/// verifier clock. Proofs stamped further in the future (or further in the
/// past) are rejected to keep the weight claim fresh.
pub const MAX_TIMESTAMP_SKEW_SECS: u64 = 300;

/// Upper bound on the replay cache so a flood of distinct nonces cannot grow
/// memory without limit. The oldest entry is evicted when the cache is full.
const MAX_CACHE_ENTRIES: usize = 100_000;

/// Bounded, TTL-evicted replay cache keyed by proof nonce.
///
/// A captured weight proof carries a signed, unique nonce. Recording each
/// nonce the first time it is accepted and rejecting it on any later attempt
/// makes a captured proof usable exactly once within the skew window, so a
/// captured signature cannot be replayed to clear multiple loads.
pub struct ReplayCache {
    seen: Mutex<HashMap<String, u64>>,
}

impl ReplayCache {
    pub fn new() -> Self {
        Self {
            seen: Mutex::new(HashMap::new()),
        }
    }

    /// Records `nonce` as seen at `now`, pruning entries that are older than
    /// the freshness window. Returns `false` (replay) if the nonce is already
    /// recorded; `true` if it was freshly recorded.
    pub fn record(&self, nonce: &str, now: u64) -> bool {
        let cutoff = now.saturating_sub(MAX_TIMESTAMP_SKEW_SECS);
        let mut seen = self.seen.lock().unwrap();
        seen.retain(|_, first_seen| *first_seen >= cutoff);

        if seen.contains_key(nonce) {
            return false;
        }

        if seen.len() >= MAX_CACHE_ENTRIES {
            if let Some(oldest) = seen
                .iter()
                .min_by_key(|(_, ts)| **ts)
                .map(|(k, _)| k.clone())
            {
                seen.remove(&oldest);
            }
        }

        seen.insert(nonce.to_string(), now);
        true
    }

    /// Number of nonces currently tracked (used by tests).
    pub fn len(&self) -> usize {
        self.seen.lock().unwrap().len()
    }

    /// Persists the seen-nonce set so a restart does not reopen the freshness
    /// window. Entries older than the skew window are dropped on save.
    pub fn persist(&self, path: &str) -> std::io::Result<()> {
        let cutoff = now_seconds().saturating_sub(MAX_TIMESTAMP_SKEW_SECS);
        let seen = self.seen.lock().unwrap();
        let entries: Vec<(String, u64)> = seen
            .iter()
            .filter(|(_, ts)| **ts >= cutoff)
            .map(|(k, v)| (k.clone(), *v))
            .collect();
        drop(seen);
        let json = serde_json::to_string(&entries)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
        std::fs::write(path, json)
    }

    /// Loads a previously persisted seen-nonce set. A missing file yields an
    /// empty cache; stale entries are pruned on the next `record`.
    pub fn load(path: &str) -> Self {
        let mut cache = Self::new();
        if let Ok(json) = std::fs::read_to_string(path) {
            if let Ok(entries) = serde_json::from_str::<Vec<(String, u64)>>(&json) {
                if let Ok(mut seen) = cache.seen.lock() {
                    for (nonce, ts) in entries {
                        seen.insert(nonce, ts);
                    }
                }
            }
        }
        cache
    }
}

impl Default for ReplayCache {
    fn default() -> Self {
        Self::new()
    }
}

pub struct ZkWeightVerifier;

impl ZkWeightVerifier {
    /// Independently enforces the weight limit and verifies the Ed25519
    /// signature over the canonical payload (weight + device limit + nonce +
    /// timestamp + vehicle/order binding), which only the weighing device's
    /// secret key can produce.
    ///
    /// The prover's self-declared validity is never trusted: the claimed axle
    /// weight is re-checked against the verifier's own `max_allowed_limit`.
    /// The proof must be bound to `required_binding` (the vehicle/order being
    /// cleared) and its nonce must never have been accepted before, so a
    /// captured proof cannot be replayed.
    pub fn verify_proof(
        proof: &WeightProofOutput,
        max_allowed_limit: u64,
        verifying_key: &VerifyingKey,
        now: u64,
        replay_cache: &ReplayCache,
        required_binding: &str,
    ) -> bool {
        // 1. Independent weight enforcement against the caller's limit.
        if proof.axle_weight_kg > max_allowed_limit {
            return false;
        }

        // 2. Timestamp freshness: reject future-stamped proofs (beyond clock
        //    skew) and stale proofs (older than the skew window).
        if proof.timestamp > now.saturating_add(MAX_TIMESTAMP_SKEW_SECS) {
            return false;
        }
        if proof.timestamp < now.saturating_sub(MAX_TIMESTAMP_SKEW_SECS) {
            return false;
        }

        // 3. The proof is bound to a vehicle/order: it must match the load
        //    being cleared, so it cannot be reused across loads even with
        //    distinct nonces.
        if proof.vehicle_id != required_binding {
            return false;
        }

        // 4. Signature check over the exact canonical payload that was signed.
        //    A tampered weight, limit, nonce, timestamp, or vehicle_id breaks
        //    the binding.
        let payload = canonical_payload(
            proof.axle_weight_kg,
            proof.max_legal_limit_kg,
            &proof.nonce,
            proof.timestamp,
            &proof.vehicle_id,
        );

        let signature_ok = match hex::decode(&proof.signature_hex) {
            Ok(bytes) => match <[u8; 64]>::try_from(bytes.as_slice()) {
                Ok(sig_bytes) => verifying_key
                    .verify_strict(&payload, &Signature::from_bytes(&sig_bytes))
                    .is_ok(),
                Err(_) => false,
            },
            Err(_) => false,
        };
        if !signature_ok {
            return false;
        }

        // 5. Replay protection: only a cryptographically valid proof consumes
        //    its nonce. A nonce seen before within the skew window is a replay
        //    and is rejected here.
        replay_cache.record(&proof.nonce, now)
    }
}
