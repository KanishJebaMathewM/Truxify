## Problem

`signLogBatch()` in `backend/api/src/lib/logSigner.js` signs only `id`, `timestamp`, `event_type`, and `user_id`. The action, resource, details, IP address, outcome, and any other fields are excluded from the HMAC. A record can therefore be modified without invalidating its signature.

## Root cause

The signer uses a fixed pipe-delimited projection of four fields rather than the record that is persisted and verified. Verification recomputes the same projection, so both sides agree on the truncated payload and never notice changes to the unsigned fields.

## Impact

- An attacker with database or backup access can rewrite the security-relevant parts of an audit event while retaining a valid signature.
- Tamper evidence is the primary control protecting the audit trail, so this defeats the purpose of signing batches.
- Differences in object key order would also make signatures unstable once more fields are included.

## Proposed fix

- Canonicalize each record recursively with sorted object keys and JSON-safe encoding.
- Sign every field except the `signature` field itself, including nested details and arrays.
- Verify the same canonical representation and reject malformed signature lengths before comparison.

## Verification

- Mutate `action`, `details`, `ip_address`, or `outcome` after signing and assert verification fails.
- Reorder object keys and assert the signature remains stable.
- Run the existing log signer tests plus a round-trip test for nested objects.

Request: @Senthil455 please assign this issue.
