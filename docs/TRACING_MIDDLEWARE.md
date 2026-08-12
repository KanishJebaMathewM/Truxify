# Tracing Middleware

## Overview

The Truxify backend instruments requests with OpenTelemetry spans. The tracing middleware starts a span for every HTTP request (except health/metrics endpoints), records status and timing on completion, and exposes trace helpers for SQL, cache, and MongoDB operations.

---

## Location

Middleware:

```
backend/api/src/middleware/tracingMiddleware.js
```

Tracer setup:

```
backend/api/src/tracing/tracing.js
```

---

## Behavior

For each request:

- Skips `/health`, `/metrics`, and `/favicon.ico`.
- Starts a span named `HTTP {method} {path}` with attributes for method, URL, user-agent, client IP, and request ID.
- Stores the span on `req.span` and the trace ID on `req.traceId`.
- Sets the `X-Trace-Id` response header.
- Binds a child logger with the trace ID.
- On response finish, records the status code and response time, marks 4xx/5xx as errors, and ends the span.

### SQL / Cache / Mongo helpers

```js
import { sqlTracingMiddleware, cacheTracingMiddleware, mongoTracingMiddleware } from '../middleware/tracingMiddleware.js';

sqlTracingMiddleware(query, params);     // "SQL Query" span
cacheTracingMiddleware('GET', key);      // "Redis GET" span
mongoTracingMiddleware('find', 'orders'); // "MongoDB find" span
```

---

## Why It Exists

Distributed tracing gives a single end-to-end view of a request across HTTP, database, cache, and queue hops, which is essential for diagnosing latency and failures in a microservice-style architecture.

---

## Testing

Automated tests verify:

- Health endpoints are skipped.
- Spans carry the expected attributes.
- Trace headers are set on the response.
- Error statuses mark the span as failed.
