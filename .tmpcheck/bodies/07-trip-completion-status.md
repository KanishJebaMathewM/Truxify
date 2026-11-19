## Problem

`aggregateTripEarnings()` and `calculateEarningsAggregation()` in `backend/api/src/services/driverEarningsService.js` counted a trip as completed when its status was `'completed'` or `undefined`. Any record with no status, including imported rows, partially written rows, and unknown future statuses, inflates the driver's completion rate and completed-trip totals.

## Root cause

The original condition used the absence of a status as a success signal. Missing data is not evidence of completion, and the same condition was duplicated in two aggregation paths, so the error affected both the summary API and the weekly chart.

## Impact

- Drivers receive an inflated completion rate, which can affect incentives, eligibility, and displayed performance.
- Unknown or malformed rows are counted as completed in both the API summary and the weekly earnings chart.
- Operators cannot distinguish genuinely completed trips from records that never received a status.

## Proposed fix

- Require `trip.status === 'completed'` in both aggregation paths.
- Leave totals and earnings unchanged; only the completed count and derived completion rate change.
- Update the fixture that encoded the old undefined-status behavior.

## Verification

- Aggregate a mixture of completed, cancelled, and missing-status trips and assert the completion rate counts only completed rows.
- Assert the weekly chart total and earnings are unchanged for the same fixture.
- Run the driver earnings service unit tests.

Request: @Senthil455 please assign this issue.
