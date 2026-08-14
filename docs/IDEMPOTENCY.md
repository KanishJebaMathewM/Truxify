# Idempotency Middleware

## Overview

The Truxify backend includes middleware that makes mutating endpoints idempotent using an `X-Idempotency-Key` request header.

Idempotency ensures that retrying the same logical operation (e.g. a client re-sending a payment or escrow request after a network timeout) does not create duplicate side effects.

---

## Location

Middleware:

```
backend/api/src/middleware/idempotency.js
```

---

## How It Works

For each request carrying an `X-Idempotency-Key`:

1. A cache key is derived from the authenticated user, HTTP method, original URL, and the idempotency key.
2. If a previous response for that key is cached, it is replayed verbatim (status code and body).
3. Otherwise the request proceeds; on completion the response is cached for the configured TTL.
4. Concurrent duplicate requests are guarded by an in-flight lock so they cannot double-execute.

---

## Cache Backend

- **Redis** is used when available so the deduplication holds across API replicas.
- An **in-memory store** (with a 10,000-entry cap and periodic eviction) is used when Redis is unavailable.
- Cacheable status codes: `200`, `201`, `202`, `204`.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `IDEMPOTENCY_LOCK_TTL_MS` | `120000` | Lock lifetime for in-flight duplicate requests |

---

## Behavior Notes

- Missing or non-string `X-Idempotency-Key` returns `400` (except in test mode).
- Cached responses respect the TTL passed to `requireIdempotency(ttlSeconds)`.
- The in-flight lock TTL is generous enough to cover long operations such as escrow confirmation.

---

## Why It Exists

Payment and escrow flows are vulnerable to double-submission when clients retry after timeouts. Idempotency keys make retries safe and are the standard mechanism used by payment gateways.

---

## Testing

Automated tests verify:

- Missing key handling.
- Response replay on key reuse.
- Concurrent duplicate request locking.
- TTL expiry behavior.
