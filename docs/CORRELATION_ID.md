# Correlation ID Middleware

## Overview

The Truxify backend includes a correlation ID middleware that propagates a request-scoped correlation ID across logs, services, and downstream calls.

A correlation ID lets you trace a single end-user request through every log line, database call, and WebSocket event it triggers, even when it fans out across multiple API replicas.

---

## Location

Middleware:

```
backend/api/src/middleware/correlationId.js
```

---

## Behavior

For every request:

- Reads the incoming `x-correlation-id` header.
- If present and non-empty, uses it (clients can propagate their own tracing ID).
- Otherwise generates a cryptographically random UUIDv4.
- Stores it on `req.correlationId`.
- Echoes it back in the `X-Correlation-ID` response header.
- Runs the rest of the request inside an `AsyncLocalStorage` context so any async work spawned by the handler can read the same correlation ID.

---

## Usage in Code

```js
// Inside a route handler or service:
const correlationId = req.correlationId;
```

Loggers in this codebase automatically attach `correlationId` to structured log entries when the middleware has run.

---

## Why It Exists

Without a correlation ID, a single user action that touches auth, caching, a database, and a WebSocket broadcast produces dozens of log lines with no shared key, making incident investigation slow. The middleware provides that shared key for free.

---

## Testing

Automated tests verify:

- A client-supplied header is propagated.
- A UUID is generated when the header is missing.
- The response header is set.
- Async continuations see the same correlation ID.
