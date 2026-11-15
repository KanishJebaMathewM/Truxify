## Problem

`createSocketRateLimiter()` in `backend/api/src/lib/socketRateLimiter.js` accepts any `maxOverRate` value. A `NaN` threshold makes `overRateCount > maxOverRate` always false, so an abusive connection is never reported. A negative or fractional value has similar effects, and an invalid injected clock can corrupt refill accounting.

## Root cause

The limiter validates refill and capacity but only loosely checks the abuse threshold. It also trusts `options.now()` to return a finite timestamp, although tests and alternate runtimes can inject clocks that return `NaN` or negative values.

## Impact

- A configuration mistake silently disables abuse detection while the connection continues to consume message budget.
- Flooding sockets can evict legitimate telemetry from the shared ring buffer and broadcast excessive room traffic.
- Non-monotonic clock values can prevent token refill or cause incorrect reset behavior.

## Proposed fix

- Require `maxOverRate` to be a safe non-negative integer and fall back to the default otherwise.
- Validate the injected clock result and reset an invalid `lastRefill` to the current finite value.
- Keep the token bucket semantics and public methods unchanged.

## Verification

- Test `NaN`, negative, fractional, and `Infinity` thresholds and assert the default is used.
- Test a clock returning `NaN` and assert the limiter does not enter an invalid refill state.
- Run the socket rate limiter tests.

Request: @Senthil455 please assign this issue.
