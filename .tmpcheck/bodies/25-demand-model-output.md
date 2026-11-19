## Problem

The demand heatmap route in `backend/api/src/routes/demandRoutes.js` reads `mlPrediction.predicted_demand` and `demandConfig.baseEarningRate` directly. A missing prediction, a string, `NaN`, or an out-of-range value propagates into the earning calculation, producing `NaN` or null in the API response. The ML gateway is a remote dependency and can return any of those shapes.

## Root cause

The route assumes the model and configuration are always well-formed numbers. There is no finite check, no range check, and no fallback for a missing prediction before arithmetic is performed.

## Impact

- Drivers see blank or nonsensical earning estimates when the model is unavailable or returns a malformed value.
- A bad model response can poison the demand multiplier used for every zone in the response.
- The route's output shape becomes inconsistent because JSON serializes `NaN` as null.

## Proposed fix

- Parse the prediction only when it is a present scalar and require a finite value in the supported 0 to 1 range.
- Fall back to a neutral 0.5 multiplier for invalid predictions.
- Validate the base earning rate and round all monetary estimates before returning them.

## Verification

- Test `null`, `undefined`, `'abc'`, `NaN`, negative, and greater-than-one predictions; assert the neutral multiplier.
- Test an invalid base earning rate and assert no null/NaN appears in the response.
- Run the demand route tests.

Request: @Senthil455 please assign this issue.
