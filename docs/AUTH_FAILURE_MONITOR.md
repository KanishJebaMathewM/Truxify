# Authentication Failure Monitor

## Overview

The Truxify backend includes a development-only middleware that monitors repeated authentication failures from the same client.

The middleware helps developers identify suspicious authentication activity during development by tracking repeated `401 Unauthorized` and `403 Forbidden` responses over a configurable time window.

---

## Location

Middleware:

```
backend/api/src/middleware/authFailureMonitor.js
```

Registration:

```
backend/api/src/index.js
```

---

## Configuration

The middleware supports the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `AUTH_FAILURE_THRESHOLD` | `5` | Number of authentication failures before a warning is logged |
| `AUTH_FAILURE_WINDOW_MS` | `60000` | Time window (milliseconds) used to group repeated failures |

---

## Tracked Events

The middleware records:

- Client IP address
- HTTP status (`401` or `403`)
- Request path
- Request method
- Failure count
- Time window

---

## Development Behavior

When running in a non-production environment:

- Monitors responses with status code **401** and **403**.
- Groups failures by client IP.
- Tracks failures within the configured time window.
- Logs a warning once the configured threshold is reached.
- Never blocks requests.
- Never rate limits clients.
- Never modifies responses.

Example warning:

```text
Repeated authentication failures detected

IP: 127.0.0.1
Status: 401
Path: /api/profile
Failure Count: 5
Window: 60000 ms
```

---

## Production Behavior

In production environments:

- Monitoring is disabled.
- No warnings are generated.
- Request handling is unaffected.

---

## Why This Middleware Exists

Repeated authentication failures may indicate:

- Invalid credentials.
- Misconfigured clients.
- Automated scanning.
- Brute-force attempts during development.

The middleware provides visibility into these patterns without changing application behavior.

---

## Extending the Middleware

Possible future improvements include:

- Route-specific thresholds.
- User-based tracking after authentication.
- Metrics integration.
- Automatic expiration of inactive client entries.
- Structured monitoring dashboards.

---

## Testing

Automated tests verify:

- Failures below the configured threshold do not generate warnings.
- Repeated `401` responses generate warnings.
- Repeated `403` responses generate warnings.
- Successful responses are ignored.
- Production mode disables monitoring.