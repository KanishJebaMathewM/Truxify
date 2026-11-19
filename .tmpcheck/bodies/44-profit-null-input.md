## Problem

`estimateTripProfit()` in `backend/api/src/services/tripProfitEstimator.js` destructures its argument and then reads `config.fuelPricePerLitre`, `config.truckKmPerLitre`, and related fields. Passing `null`, a non-object, or `{config: null}` throws even though the function is documented to return an estimate for missing data.

## Root cause

The default parameter only covers `undefined`, not `null` or other primitive inputs. The config default is applied only when the whole argument is omitted, not when `config` is explicitly null.

## Impact

- A driver app request with no pricing data can produce a 500 instead of a zero/default estimate.
- The estimator's public contract says missing data is safe, so callers do not add their own guards.
- Malformed API payloads can take down the profit preview for the whole request.

## Proposed fix

- Normalize non-object input to an empty object before destructuring.
- Normalize a non-object `config` to an empty override object.
- Keep the existing finite-positive fallbacks for individual values.

## Verification

- Call with `null`, `undefined`, a string, a number, and `{config: null}` and assert no throw.
- Assert valid partial overrides still apply.
- Run the trip profit estimator tests.

Request: @Senthil455 please assign this issue.
