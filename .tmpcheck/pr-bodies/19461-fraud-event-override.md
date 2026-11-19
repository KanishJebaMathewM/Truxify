## Problem

The fraud event route in `backend/api/src/routes/fraudRoutes.js` spreads the client-supplied `data` object after setting `type: eventType`. A caller can include `data.type` and replace the server-selected event category. Empty or missing `eventType` values also reach the service instead of being rejected.

## Change

- Require a non-empty trimmed `eventType` and return 400 when absent.
- Spread client data first, then set the trusted `type` field from the validated event type.
- Reject non-object or array `data` values before merging.

## Verification

- Send `{eventType: 'login', data: {type: 'payment'}}` and assert the stored type is `login`.
- Send missing, empty, and whitespace-only event types and assert 400.
- Run the fraud route tests.

Closes #19461
