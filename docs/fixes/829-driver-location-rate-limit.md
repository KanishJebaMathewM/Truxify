# Fix #829: Apply userLimiter rate-limit middleware to GET /:id/driver-location endpoint

## Issue
The GET /:id/driver-location endpoint in backend/api/src/routes/orderRoutes.js was missing the userLimiter rate-limiting middleware that protects other routes, creating a potential for abuse or DoS on the MongoDB telemetry query endpoint.

## Resolution
The userLimiter middleware has been applied to the GET /:id/driver-location endpoint to prevent abuse and maintain consistency with other user-facing routes.

## Implementation Details

**File**: `backend/api/src/routes/orderRoutes.js`
**Route**: `GET /:id/driver-location`

The endpoint now includes:
- `authenticate` - Ensures user is authenticated
- `userLimiter` - Rate limits requests per user
- `telemetryLimiter` - Additional telemetry-specific rate limiting
- `requirePolicy('order:view-driver-location')` - Policy-based access control
- `validateParams(paramIdSchema)` - Validates the order ID parameter

## Security Impact
- Prevents abuse or DoS on MongoDB telemetry queries
- Consistent rate limiting across all user-facing endpoints
- Protects database resources from excessive queries

## Testing
The rate limiting is applied at the middleware level and is tested through:
- Unit tests for rate limiter middleware
- Integration tests for endpoint access
- Load testing to verify limits are enforced

## Verification
This fix has been verified to be in place on the current codebase.
