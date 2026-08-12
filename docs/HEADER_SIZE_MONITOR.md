# Request Header Size Monitor

## Overview

The Truxify backend includes a development-only middleware that monitors the total size of incoming HTTP request headers.

Large request headers can indicate oversized authentication tokens, excessive custom headers, or potential abuse. The middleware helps developers identify these situations during development without affecting normal request processing.

---

## Location

Middleware:

```
backend/api/src/middleware/headerSizeMonitor.js
```

Registration:

```
backend/api/src/index.js
```

---

## Configuration

The middleware uses the following environment variable:

| Variable | Default | Description |
|----------|---------|-------------|
| `HEADER_SIZE_LIMIT` | `8192` bytes | Maximum allowed request header size before a warning is logged |

If the environment variable is not provided, the middleware uses the default value of **8192 bytes (8 KB)**.

---

## Development Behavior

When running in a non-production environment:

- Calculates the combined size of all incoming request headers.
- Compares the calculated size against the configured limit.
- Logs a warning if the limit is exceeded.
- Requests continue normally.
- No request headers are modified.
- No requests are rejected.

Example warning:

```text
Request headers exceed configured size threshold

Method: GET
Path: /api/orders
Header Size: 9642 bytes
Configured Limit: 8192 bytes
```

---

## Production Behavior

In production environments:

- Header size monitoring is disabled.
- No warnings are logged.
- Request processing is unaffected.

---

## Why This Middleware Exists

Oversized request headers may indicate:

- Excessively large authentication tokens.
- Unexpected client behavior.
- Header abuse.
- Misconfigured applications repeatedly sending large custom headers.

This middleware provides early visibility into these situations during development without changing application behavior.

---

## Extending the Middleware

The middleware can be extended to support:

- Different limits for specific routes.
- Separate limits for authentication headers.
- Metrics collection.
- Monitoring specific headers individually.

---

## Testing

Automated tests verify:

- Requests below the configured limit do not generate warnings.
- Requests exceeding the configured limit generate warnings.
- Custom header size limits are respected.
- Production mode disables monitoring.