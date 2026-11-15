## Problem

`OrderTimelineService.completeOrderPlacedMilestone()` and `deleteOrderTimeline()` in `backend/api/src/services/order/orderTimelineService.js` are documented as best-effort cleanup, but both throw a `DomainError` when the repository returns an error. The cancellation flow has already changed the order status by the time these run, so a timeline failure turns a successful cancellation into an error response.

## Change

- Return `false` after logging a repository error instead of throwing.
- Return `true` on success so callers can optionally observe the outcome.
- Keep the existing repository calls and milestone timestamps unchanged.

## Verification

- Make each repository method return an error and assert the service resolves without throwing.
- Assert the success path still updates and deletes the expected rows.
- Run the order timeline service tests.

Closes #19478
