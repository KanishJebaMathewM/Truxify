## Problem

The webhook route in `backend/api/src/routes/webhookRoutes.js` falls back to an in-process replay map when Redis is unavailable. A per-process map cannot prevent a captured request from being replayed against a different replica, so production loses replay protection exactly when Redis is degraded. The nonce check also accepts empty and oversized values.

## Root cause

The fallback was designed for local development but is selected based on Redis availability rather than environment. Nonce validation only checks presence, not type or length, before using it as a replay key.

## Impact

- A replayed escrow or payment webhook can be processed by multiple replicas, causing duplicate state transitions.
- An attacker can bypass replay protection during a Redis outage, which is also when retries are most likely.
- Empty or huge nonces create ambiguous or memory-heavy replay keys.

## Proposed fix

- In production, refuse to process a webhook when the shared replay store is unavailable.
- Keep the in-memory fallback only for non-production environments.
- Require the nonce to be a non-empty string of at most 128 characters and return 401 otherwise.

## Verification

- Simulate Redis unavailable in production and assert the request is rejected before side effects.
- Assert the in-memory fallback still works in test/development.
- Test missing, empty, non-string, and 129-character nonces.

Request: @Senthil455 please assign this issue.
