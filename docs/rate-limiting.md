# Rate Limiting Configuration

Truxify uses `express-rate-limit` with Redis-backed stores for distributed deployments. All limits are configurable via environment variables.

## Environment Variables

### Global Limits

| Variable | Default | Description |
|---|---|---|
| `GLOBAL_RATE_LIMIT_WINDOW_MS` | 900000 (15 min) | Time window for the global rate limit |
| `GLOBAL_RATE_LIMIT_MAX_REQUESTS` | 1000 | Max requests per window globally |

### User Limits

| Variable | Default | Description |
|---|---|---|
| `USER_RATE_LIMIT_WINDOW_MS` | 900000 (15 min) | Time window for per-user rate limiting |
| `USER_RATE_LIMIT_MAX_REQUESTS` | 300 | Max requests per user per window |

### Health Endpoint Limits

| Variable | Default | Description |
|---|---|---|
| `HEALTH_RATE_LIMIT_WINDOW_MS` | 60000 (1 min) | Time window for health endpoint |
| `HEALTH_RATE_LIMIT_MAX_REQUESTS` | 60 | Max health check requests per window |

### Auth Limits

| Variable | Default | Description |
|---|---|---|
| `AUTH_RATE_LIMIT_WINDOW_MS` | 3600000 (1 hour) | Time window for authentication endpoints |
| `AUTH_RATE_LIMIT_MAX_REQUESTS` | 10 | Max auth attempts per window |

### Bid Limits

| Variable | Default | Description |
|---|---|---|
| `BID_RATE_LIMIT_WINDOW_MS` | 60000 (1 min) | Time window for bid submission |
| `BID_RATE_LIMIT_MAX_REQUESTS` | 30 | Max bids per window |

### Device Limits

| Variable | Default | Description |
|---|---|---|
| `DEVICE_RATE_LIMIT_WINDOW_MS` | 600000 (10 min) | Time window for device registration |
| `DEVICE_RATE_LIMIT_MAX_REQUESTS` | 10 | Max device registrations per window |

### OTP Verification Limits

| Variable | Default | Description |
|---|---|---|
| `OTP_VERIFICATION_RATE_LIMIT_WINDOW_MS` | 900000 (15 min) | Time window for OTP verification |
| `OTP_VERIFICATION_RATE_LIMIT_MAX_REQUESTS` | 5 | Max OTP verification attempts per window |

### POD Upload Limits

| Variable | Default | Description |
|---|---|---|
| `POD_RATE_LIMIT_WINDOW_MS` | 3600000 (1 hour) | Time window for POD uploads |
| `POD_RATE_LIMIT_MAX_REQUESTS` | 10 | Max POD uploads per window |

### Admin Limits

| Variable | Default | Description |
|---|---|---|
| `ADMIN_RATE_LIMIT_WINDOW_MS` | 900000 (15 min) | Time window for admin endpoints |
| `ADMIN_RATE_LIMIT_MAX_REQUESTS` | 50 | Max admin requests per window |

## Implementation Notes

- All window values are in **milliseconds**
- Rate limiters use Redis-backed stores via `createStore()` from this module
- When Redis is unavailable, rate limiting falls back to an in-memory store
- Rate limit headers (`RateLimit-*`) are added to responses when `standardHeaders: true`
- `keyGenerator` defaults to IP address; some limiters use `userId` for authenticated routes

## Override Behavior

If an environment variable is set to an invalid value (non-numeric or negative), the middleware falls back to the default value and logs a warning.
