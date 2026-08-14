## Problem

`CircuitBreaker.execute()` only rejects when the state is `OPEN`. In `HALF_OPEN` (the recovery probe window) it falls through and runs `fn()` exactly like `CLOSED`, so a burst of concurrent requests during the probe hammers the very dependency trying to recover — a retry storm that can extend the outage into a cascading failure.

## Fix

- Added a `_halfOpenProbeInFlight` gate. In `HALF_OPEN`, only the first request is admitted as the trial probe; any additional `HALF_OPEN` request is short-circuited like `OPEN` (returns the fallback or throws).
- The gate is cleared in `onSuccess()` (probe succeeded → CLOSED) and in `onFailure()` (probe failed → OPEN), so the next recovery window starts fresh.

## Files changed

- backend/api/src/lib/circuitBreaker.js
- backend/api/test/unit/circuitBreaker.test.js

## Testing

- Added a regression test in `circuitBreaker.test.js` asserting that only one probe runs in `HALF_OPEN` and the extra concurrent request is short-circuited to the fallback (`probeFn` called exactly once).

Closes #11398
