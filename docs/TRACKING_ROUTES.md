# Tracking Share Routes

Endpoints for generating and revoking public tracking share links.

## POST /api/orders/:id/share-tracking

Generates a shareable tracking link for the order with display id `:id`.

- The order must belong to the requesting customer (403 otherwise).
- Terminal orders (`delivered`, `cancelled`, `payment_released`) cannot be
  shared (400).

Response:

```json
{
  "trackingUrl": "https://.../track/<token>",
  "token": "<token>",
  "expiresAt": "2026-08-11T00:00:00.000Z"
}
```

## POST /api/orders/:id/share-tracking/revoke

Revokes every active tracking token for the order.

```json
{ "success": true, "message": "All tracking links revoked" }
```

### Rate limiting

- Share: 10 requests / minute per user.
- Public tracking: 30 requests / minute per IP.

Both endpoints require the `order:view-active` policy.
