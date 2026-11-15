## Problem

The tracking link regeneration route in `backend/api/src/routes/trackingRoutes.js` revokes existing links before checking `PUBLIC_TRACKING_URL` and before creating the replacement. If the variable is unset or the insert fails, the customer is left with no working tracking link at all.

## Change

- Validate `PUBLIC_TRACKING_URL` before touching existing tokens.
- Capture the previous token IDs, create the replacement, then revoke only those previous IDs.
- Return 503 when tracking links are not configured.

## Verification

- Unset `PUBLIC_TRACKING_URL` and assert the old token remains active and the route returns 503.
- Make token creation fail and assert the old token is untouched.
- On success, assert the new token is active and only old IDs are revoked.

Closes #19465
