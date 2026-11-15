## Problem

`estimateTripProfit()` in `backend/api/src/services/tripProfitEstimator.js` destructures its argument and then reads `config.fuelPricePerLitre`, `config.truckKmPerLitre`, and related fields. Passing `null`, a non-object, or `{config: null}` throws even though the function is documented to return an estimate for missing data.

## Change

- Normalize non-object input to an empty object before destructuring.
- Normalize a non-object `config` to an empty override object.
- Keep the existing finite-positive fallbacks for individual values.

## Verification

- Call with `null`, `undefined`, a string, a number, and `{config: null}` and assert no throw.
- Assert valid partial overrides still apply.
- Run the trip profit estimator tests.

Closes #19479
