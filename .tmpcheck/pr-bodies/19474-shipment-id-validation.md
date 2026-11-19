## Problem

The shipment details route in `backend/api/src/routes/shipmentRoutes.js` declares `shipmentId` as an optional string of up to 100 characters, while the controller requires it. Any non-UUID string is forwarded to a Postgres UUID comparison, which raises a database error and returns a generic 500 instead of a client error.

## Change

- Require `shipmentId` to be a UUID in the route schema.
- Keep the parameter required so validation matches the controller contract.
- Update the route tests to use UUID fixtures and assert the validation error shape.

## Verification

- Request a non-UUID ID and assert 400 before the controller.
- Request a valid UUID that does not exist and assert the existing 404 path.
- Request a valid shipment and assert the existing 200 response.

Closes #19474
