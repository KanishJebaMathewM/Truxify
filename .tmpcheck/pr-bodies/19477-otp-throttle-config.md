## Problem

`backend/api/src/services/order/orderNotificationService.js` parses `OTP_MAX_FAILED_ATTEMPTS`, `OTP_LOCKOUT_MINUTES`, and `IN_MEMORY_OTP_MAP_MAX_SIZE` with `parseInt()` and uses the results without bounds. A zero or negative lockout creates an invalid Redis `EX 0` TTL or a lock that expires immediately; a non-numeric attempt limit makes every comparison false.

## Change

- Add a `boundedPositiveInt()` helper that requires a safe integer within a documented range.
- Apply it to TTL, failed-attempt limit, lockout duration, and in-memory map capacity with safe fallbacks.
- Keep the exported constants numeric so existing callers and tests are unaffected.

## Verification

- Import the module with zero, negative, fractional, non-numeric, and oversized environment values and assert the fallbacks.
- Assert valid values are preserved.
- Run the OTP notification and fallback-capacity tests.

Closes #19477
