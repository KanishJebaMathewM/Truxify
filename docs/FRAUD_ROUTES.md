# Fraud Detection Routes

Endpoints for fraud statistics, risk scoring, and the review queue.

## GET /api/fraud/stats

Returns aggregate fraud statistics. Requires `fraud:view-stats`.

## GET /api/fraud/risk/:userId

Returns behavioral and network risk for a user.

```json
{
  "success": true,
  "data": { "userId": "...", "behavioralRisk": 0.3, "networkRisk": 0.1, "isInFraudRing": false }
}
```

## GET /api/fraud/review-queue

Returns up to 50 flagged reviews. Requires `fraud:manage-review`.

## POST /api/fraud/review/:reviewId/resolve

Resolves a flagged review with `{ action, notes }`.

## POST /api/fraud/track

Records a behavior event for the authenticated user. Body:
`{ userId?, eventType, data? }`. A `userId` that does not match the
authenticated user returns 400.

## POST /api/fraud/analyze-network/:userId

Runs a manual network analysis for a user.

All endpoints require authentication and per-user rate limiting.
