## Problem

`signLogBatch()` in `backend/api/src/lib/logSigner.js` signs only `id`, `timestamp`, `event_type`, and `user_id`. The action, resource, details, IP address, outcome, and any other fields are excluded from the HMAC. A record can therefore be modified without invalidating its signature.

## Change

- Canonicalize each record recursively with sorted object keys and JSON-safe encoding.
- Sign every field except the `signature` field itself, including nested details and arrays.
- Verify the same canonical representation and reject malformed signature lengths before comparison.

## Verification

- Mutate `action`, `details`, `ip_address`, or `outcome` after signing and assert verification fails.
- Reorder object keys and assert the signature remains stable.
- Run the existing log signer tests plus a round-trip test for nested objects.

Closes #19438
