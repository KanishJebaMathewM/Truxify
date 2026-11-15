## Problem

`createSocketRateLimiter()` in `backend/api/src/lib/socketRateLimiter.js` accepts any `maxOverRate` value. A `NaN` threshold makes `overRateCount > maxOverRate` always false, so an abusive connection is never reported. A negative or fractional value has similar effects, and an invalid injected clock can corrupt refill accounting.

## Change

- Require `maxOverRate` to be a safe non-negative integer and fall back to the default otherwise.
- Validate the injected clock result and reset an invalid `lastRefill` to the current finite value.
- Keep the token bucket semantics and public methods unchanged.

## Verification

- Test `NaN`, negative, fractional, and `Infinity` thresholds and assert the default is used.
- Test a clock returning `NaN` and assert the limiter does not enter an invalid refill state.
- Run the socket rate limiter tests.

Closes #19447
