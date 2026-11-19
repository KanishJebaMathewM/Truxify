## Problem

The relay plan route in `backend/api/src/routes/relayRoutes.js` accepts origin and destination coordinates, `totalAmount`, and `maxLegDistanceKm` without validating their ranges or numeric types. Strings, `NaN`, and out-of-range latitudes reach the relay planner, where they can produce invalid legs or a 500.

## Root cause

The route passes `req.body` straight to the planner. It validates neither coordinate bounds nor the sign and finiteness of monetary and distance fields.

## Impact

- Malformed coordinates can create impossible routes or fail deep inside the planner with an opaque error.
- Negative or non-numeric amounts can corrupt relay payment calculations.
- Zero or negative leg distances can produce unbounded or empty plans.

## Proposed fix

- Add a shared coordinate validator requiring finite lat/lng within the geographic bounds.
- Require `totalAmount` to be non-negative and `maxLegDistanceKm` to be positive when provided.
- Return 400 with a field-specific message before the planner runs.

## Verification

- Test missing, string, NaN, and out-of-range coordinates.
- Test negative amounts and zero/negative leg distances.
- Assert a valid relay plan still reaches the planner.

Request: @Senthil455 please assign this issue.
