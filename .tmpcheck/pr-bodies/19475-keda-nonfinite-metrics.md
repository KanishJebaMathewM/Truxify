## Problem

`KEDAService.getMetrics()` in `backend/api/src/services/kedaService.js` converts a Prometheus sample with `Number(...)` and returns success even when the value is `NaN` or `Infinity`. Prometheus uses the literal string `NaN` for undefined arithmetic. The recommendation code then compares and returns that value, and JSON serializes it as null.

## Change

- Require a numeric, finite sample value and return a structured failure for non-finite samples.
- Preserve the existing zero result for an empty Prometheus result set.
- Validate interval and timeout options as positive finite numbers before scheduling.

## Verification

- Mock Prometheus returning `NaN`, `Infinity`, and a valid numeric string; assert failure for non-finite values.
- Mock an empty result set and assert value 0.
- Test negative and zero polling options and assert defaults are used.

Closes #19475
