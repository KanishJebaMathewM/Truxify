## Problem

The shipment details route in `backend/api/src/routes/shipmentRoutes.js` declares `shipmentId` as an optional string of up to 100 characters, while the controller requires it. Any non-UUID string is forwarded to a Postgres UUID comparison, which raises a database error and returns a generic 500 instead of a client error.

## Root cause

The Zod schema validates only presence and length. The controller reads the query parameter and passes it directly to `.eq('id', shipmentId)` on an `orders.id` UUID column.

## Impact

- A malformed client request produces a 500 and an error log rather than a 400, obscuring real server failures.
- Invalid IDs can trigger unnecessary database work and log noise.
- Clients cannot distinguish a bad request from a missing shipment.

## Proposed fix

- Require `shipmentId` to be a UUID in the route schema.
- Keep the parameter required so validation matches the controller contract.
- Update the route tests to use UUID fixtures and assert the validation error shape.

## Verification

- Request a non-UUID ID and assert 400 before the controller.
- Request a valid UUID that does not exist and assert the existing 404 path.
- Request a valid shipment and assert the existing 200 response.

Request: @Senthil455 please assign this issue.
