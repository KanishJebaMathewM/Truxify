# Oracle Routes

The oracle endpoints drive delivery verification through a 2-of-3 provider
consensus model (OTP, GPS, order status).

## GET /api/oracle/status

Returns the configured provider counts.

```json
{
  "success": true,
  "data": { "providers": 3, "threshold": 2, "timestamp": "..." }
}
```

## POST /api/oracle/confirm

Verifies a delivery using the request body `{ orderId, otp, gpsCoordinates }`.

Returns the per-provider results and whether consensus was reached.

## POST /api/oracle/verify-crosschain

Verifies an on-chain escrow hash against the order record. Body:
`{ orderId, blockchainHash }`.

### Authorization

Both write endpoints call `authorizeOrderAccess` first: the caller must own
the order or be its assigned driver, otherwise a 403 is returned.

### Rate limiting

Write endpoints are limited to 300 requests per 15 minutes per IP.
