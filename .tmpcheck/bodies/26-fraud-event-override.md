## Problem

The fraud event route in `backend/api/src/routes/fraudRoutes.js` spreads the client-supplied `data` object after setting `type: eventType`. A caller can include `data.type` and replace the server-selected event category. Empty or missing `eventType` values also reach the service instead of being rejected.

## Root cause

Object spread order gives client fields precedence over server-owned fields. The route validates that a body exists but does not require a non-empty string event type before merging.

## Impact

- A caller can record an event under a different category, bypassing per-event fraud rules and corrupting model training data.
- Missing event types produce ambiguous records that cannot be routed or scored.
- Security decisions based on event type can be evaded by a single client-controlled property.

## Proposed fix

- Require a non-empty trimmed `eventType` and return 400 when absent.
- Spread client data first, then set the trusted `type` field from the validated event type.
- Reject non-object or array `data` values before merging.

## Verification

- Send `{eventType: 'login', data: {type: 'payment'}}` and assert the stored type is `login`.
- Send missing, empty, and whitespace-only event types and assert 400.
- Run the fraud route tests.

Request: @Senthil455 please assign this issue.
