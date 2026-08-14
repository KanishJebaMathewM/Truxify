# Request ID & Tracing Middleware

## Overview

The Truxify backend includes request ID middleware that attaches a stable, sanitized request ID to every request and exposes it in response headers and logs.

---

## Location

Middleware:

```
backend/api/src/middleware/requestId.js
```

---

## Behavior

For every request:

- Reads the incoming `x-request-id` header.
- Accepts it only when it matches a safe pattern (`/^[A-Za-z0-9_-]{1,64}$/`); otherwise generates a UUIDv4. This prevents log-injection through crafted header values.
- Stores it on `req.requestId` and `res.locals.requestId`.
- Echoes it back in the `X-Request-Id` response header.

### requestLogger

The `requestLogger` middleware creates a per-request child logger bound to the request ID (and correlation ID when present) and writes an access log line on response finish with method, path, status, and duration.

### addTracingHeaders

The `addTracingHeaders` middleware adds:

- `X-Trace-Id` — the request ID.
- `X-Span-Id` — a short random span identifier.
- `X-User-Id` — a truncated user ID when authenticated.

---

## Why It Exists

Request IDs give operations a stable handle for correlating access logs, errors, and support tickets, and the sanitization prevents attackers from injecting fake IDs or control characters into logs.

---

## Testing

Automated tests verify:

- Client-supplied request IDs are propagated when safe.
- Unsafe header values fall back to a generated UUID.
- Response headers are set.
- The access log line is written on response finish.
