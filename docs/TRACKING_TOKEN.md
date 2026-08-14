# Tracking Token Service

## Overview

The Truxify backend issues shareable tracking tokens so customers can share live order tracking with a third party without exposing their account. Tokens are hashed at rest and expire after 7 days (`services/trackingTokenService.js`).

---

## Location

```
backend/api/src/services/trackingTokenService.js
```

---

## Behavior

- `createToken({ orderDisplayId, createdBy })` generates a 32-byte random token (`base64url`), stores only its SHA-256 hash, and returns the raw token to the caller exactly once.
- `validateToken(rawToken)` hashes the presented token and looks it up:
  - `valid: true` with the order display ID when found, unrevoked, and unexpired.
  - `not_found`, `revoked`, or `expired` reasons otherwise.
  - `validation_error` on database errors.
- `revokeToken(tokenId)` / `revokeAllForOrder(orderDisplayId)` invalidate tokens.
- `getExpiryDate()` returns the 7-day expiry.

---

## Why It Exists

A raw token is the only credential a recipient holds — it is not stored, so a database leak cannot be used to mint valid tokens. Hashing, expiry, and revocation keep shared tracking safe and bounded.

---

## Public Tracking

The public tracking routes (`routes/publicTrackingRoutes.js`) validate the token and expose only a safe order subset (no customer ID, payment details, or OTP).

---

## Testing

Automated tests verify:

- Token generation/hashing round-trip.
- Validate outcomes (valid, not_found, revoked, expired).
- Revocation and expiry handling.
