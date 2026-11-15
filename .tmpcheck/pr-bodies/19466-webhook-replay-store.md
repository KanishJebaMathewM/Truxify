## Problem

The webhook route in `backend/api/src/routes/webhookRoutes.js` falls back to an in-process replay map when Redis is unavailable. A per-process map cannot prevent a captured request from being replayed against a different replica, so production loses replay protection exactly when Redis is degraded. The nonce check also accepts empty and oversized values.

## Change

- In production, refuse to process a webhook when the shared replay store is unavailable.
- Keep the in-memory fallback only for non-production environments.
- Require the nonce to be a non-empty string of at most 128 characters and return 401 otherwise.

## Verification

- Simulate Redis unavailable in production and assert the request is rejected before side effects.
- Assert the in-memory fallback still works in test/development.
- Test missing, empty, non-string, and 129-character nonces.

Closes #19466
