# Rate Limiting and Throttling Architecture

This document describes the rate limiting and throttling architecture used in the Truxify backend API.

## Overview

The Truxify backend uses multiple layers of rate limiting to protect against abuse, ensure fair resource allocation, and prevent denial-of-service conditions. Rate limiters are implemented at both the HTTP middleware level and the WebSocket level.

## Rate Limiting Strategies

### 1. Redis-Backed Rate Limiting (`redisRateLimiter`)

**Location:** `backend/api/src/middleware/redisRateLimiter.js`

Redis-backed rate limiting uses a sliding window algorithm stored in Redis. This is the most scalable option for distributed deployments.

- **Key format:** `ratelimit:<identifier>:<endpoint>`
- **Default window:** 1 minute
- **Default limit:** 100 requests per window per user/IP
- **When to use:** For API endpoints that need accurate, distributed rate limiting across multiple server instances.

```javascript
import { redisRateLimiter } from '../middleware/rateLimiter.js';
router.post('/api/resource', redisRateLimiter, async (req, res) => { ... });
```

### 2. In-Memory Rate Limiting

**Location:** `backend/api/src/middleware/rateLimiter.js`

In-memory rate limiting uses a sliding window stored in a JavaScript Map. This is suitable for single-instance deployments or as a fallback when Redis is unavailable.

- **When to use:** As a fallback when Redis is unavailable, or for low-traffic internal endpoints.

### 3. Per-User Rate Limiting (`userLimiter`)

Applied to authenticated endpoints. Limits requests per authenticated user.

- **Default:** 60 requests per minute per user
- **Key generator:** Uses `req.user.id` to scope the limit

```javascript
router.post('/api/action', authenticate, userLimiter, async (req, res) => { ... });
```

### 4. Per-IP Rate Limiting

Applied to unauthenticated endpoints. Limits requests per IP address.

- **Key generator:** Uses `req.ip` to scope the limit
- **Use case:** Login endpoints, public APIs

### 5. Endpoint-Specific Rate Limiters

Individual endpoints can define their own rate limiters for specialized limits:

- **`podUploadLimiter`:** Limits PoD (proof-of-delivery) image uploads. Since uploads trigger a malware scan and are stored in RAM by multer, a per-driver-per-order limit prevents abuse.
- **`verifyDeliveryLimiter`:** Limits OTP verification attempts.
- **`healthLimiter`:** Limits health check endpoint hits.

## WebSocket Rate Limiting

**Location:** `backend/api/src/sockets/tracker.js`

WebSocket connections have a separate rate limiter that limits:

- **Connection rate:** Maximum connections per IP per minute
- **Message rate:** Maximum messages per second per authenticated user
- **In-memory fallback:** When Redis is unavailable, an in-memory sliding window is used

```javascript
// Example: Connection rate limit check
const allowed = await checkWsConnectionLimit(ipAddress);
if (!allowed) {
  socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
  socket.destroy();
}
```

## Idempotency Key Rate Limiting

**Location:** `backend/api/src/middleware/idempotency.js`

The idempotency middleware prevents duplicate processing of the same request. It uses either Redis or an in-memory store (with a maximum of 10,000 entries).

- **TTL:** Default 3600 seconds (1 hour)
- **Lock TTL:** 120 seconds (prevents duplicate processing during long operations)

## Configuration

Rate limiting is configured via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `REDIS_URL` | Not set | Redis connection URL. If not set, falls back to in-memory limiting. |
| `RATE_LIMIT_WINDOW_MS` | 60000 | Sliding window size in milliseconds |
| `RATE_LIMIT_MAX` | 100 | Maximum requests per window |
| `IDEMPOTENCY_LOCK_TTL_MS` | 120000 | Lock TTL for idempotency middleware |

## Adding a New Rate-Limited Endpoint

1. Choose the appropriate rate limiter type (per-user, per-IP, or custom).
2. Import the limiter in your route file:

```javascript
import { userLimiter, createStore, safeIpKeyGenerator } from '../middleware/rateLimiter.js';

// Apply to your route
router.post('/api/new-endpoint', authenticate, userLimiter, async (req, res) => {
  // Handler code
});
```

3. Test with load testing tools (e.g., `wrk`, `ab`) to verify limits are enforced correctly.

## Debugging Rate Limit Issues

When a request is rate-limited, the API returns:

```json
{
  "error": "Too many requests. Please try again later.",
  "retryAfter": 30
}
```

HTTP status: `429 Too Many Requests`

Check server logs for `[rateLimit]` entries to identify which limit was triggered.

## Gotchas

- **Redis unavailable:** All Redis-backed rate limiters fall back to in-memory. The in-memory store has bounded size limits to prevent unbounded memory growth.
- **IP spoofing:** `req.ip` can be spoofed if Express is misconfigured behind a proxy. Always use `trust proxy` setting in production.
- **WebSocket upgrades:** WebSocket connections use a separate rate limiter from HTTP requests. They are not counted against HTTP rate limits.
