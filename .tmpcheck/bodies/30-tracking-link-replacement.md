## Problem

The tracking link regeneration route in `backend/api/src/routes/trackingRoutes.js` revokes existing links before checking `PUBLIC_TRACKING_URL` and before creating the replacement. If the variable is unset or the insert fails, the customer is left with no working tracking link at all.

## Root cause

The operation is ordered revoke-then-create. There is also a blanket revoke that can revoke the newly created token if it runs after insertion, so the implementation cannot simply be reordered without tracking the old IDs.

## Impact

- A configuration error or transient database failure permanently removes the only customer-facing tracking link.
- Support must manually regenerate links, and the customer cannot track an active shipment in the meantime.
- Retries can revoke the replacement token, extending the outage.

## Proposed fix

- Validate `PUBLIC_TRACKING_URL` before touching existing tokens.
- Capture the previous token IDs, create the replacement, then revoke only those previous IDs.
- Return 503 when tracking links are not configured.

## Verification

- Unset `PUBLIC_TRACKING_URL` and assert the old token remains active and the route returns 503.
- Make token creation fail and assert the old token is untouched.
- On success, assert the new token is active and only old IDs are revoked.

Request: @Senthil455 please assign this issue.
