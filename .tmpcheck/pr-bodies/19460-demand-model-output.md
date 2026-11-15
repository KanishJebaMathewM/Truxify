## Problem

The demand heatmap route in `backend/api/src/routes/demandRoutes.js` reads `mlPrediction.predicted_demand` and `demandConfig.baseEarningRate` directly. A missing prediction, a string, `NaN`, or an out-of-range value propagates into the earning calculation, producing `NaN` or null in the API response. The ML gateway is a remote dependency and can return any of those shapes.

## Change

- Parse the prediction only when it is a present scalar and require a finite value in the supported 0 to 1 range.
- Fall back to a neutral 0.5 multiplier for invalid predictions.
- Validate the base earning rate and round all monetary estimates before returning them.

## Verification

- Test `null`, `undefined`, `'abc'`, `NaN`, negative, and greater-than-one predictions; assert the neutral multiplier.
- Test an invalid base earning rate and assert no null/NaN appears in the response.
- Run the demand route tests.

Closes #19460
