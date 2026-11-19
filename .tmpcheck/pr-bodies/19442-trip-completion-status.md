## Problem

`aggregateTripEarnings()` and `calculateEarningsAggregation()` in `backend/api/src/services/driverEarningsService.js` counted a trip as completed when its status was `'completed'` or `undefined`. Any record with no status, including imported rows, partially written rows, and unknown future statuses, inflates the driver's completion rate and completed-trip totals.

## Change

- Require `trip.status === 'completed'` in both aggregation paths.
- Leave totals and earnings unchanged; only the completed count and derived completion rate change.
- Update the fixture that encoded the old undefined-status behavior.

## Verification

- Aggregate a mixture of completed, cancelled, and missing-status trips and assert the completion rate counts only completed rows.
- Assert the weekly chart total and earnings are unchanged for the same fixture.
- Run the driver earnings service unit tests.

Closes #19442
