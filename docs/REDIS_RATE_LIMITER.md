# Redis Rate Limiter Middleware

## Overview

The Truxify backend includes a Redis-backed sliding-window rate limiter (`redisRateLimiter`) for enforcing per-user request limits on sensitive routes such as ZKP verification.

---

## Location

Middleware:

```
backend/api/src/middleware/redisRateLimiter.js
```

---

## How It Works

For each request, a Redis sorted set keyed `rl:{routeKey}:{userId}` tracks request timestamps:

1. Remove members older than the window (`ZREMRANGEBYSCORE`).
2. Count the remaining members (`ZCARD`).
3. If the count is at or above the limit, respond `429 Too Many Requests` with a `Retry-After` header.
4. Otherwise record the request (`ZADD`), set the key TTL, and continue.

Blocked requests are intentionally **not** recorded, so a client retrying after a 429 cannot extend its own ban.

---

## Configuration

The limiter is created per route:

```js
redisRateLimiter({
  routeKey: 'zkp_verify',   // unique route name
  limit: 5,                 // max requests per window
  windowMs: 60 * 60 * 1000, // 1 hour window
  failClosed: true,         // 503 when Redis is unavailable
})
```

---

## Failure Semantics

- **failClosed: true** — a Redis outage returns `503` so the protected route is not left unguarded.
- **failClosed: false** (default) — a Redis outage logs a warning and lets the request through (fail open).

---

## Why It Exists

Routes that trigger expensive or irreversible work (blockchain transactions, proof generation, payment submission) need strict per-user limits to prevent gas-draining abuse and resource exhaustion. A Redis-backed limiter keeps the counters consistent across API replicas.

---

## Testing

Automated tests verify:

- Requests within the window are allowed.
- Requests beyond the limit receive 429 with Retry-After.
- Stale entries are evicted from the window.
- Fail-open and fail-closed Redis outage behavior.
