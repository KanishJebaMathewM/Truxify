# Security Header Duplicate Detection Middleware

## Overview

The Truxify backend includes a development-only middleware that detects duplicate assignments of important HTTP security headers.

Duplicate assignments may indicate conflicting middleware, accidental configuration overrides, or redundant security header configuration. The middleware helps developers identify these issues early without affecting application behavior.

---

## Location

Middleware:

```
backend/api/src/middleware/securityHeaderDuplicates.js
```

Registration:

```
backend/api/src/index.js
```

---

## Monitored Headers

The middleware monitors duplicate assignments for the following response headers:

- `Content-Security-Policy`
- `X-Frame-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Opener-Policy`

Additional headers can be added by extending the monitored header list.

---

## Development Behavior

When running in a non-production environment:

- Every call to `res.setHeader()` is monitored.
- Assignments to monitored security headers are tracked.
- If the same monitored header is assigned more than once during a request, a warning is logged.
- Requests continue normally.
- Response headers are not modified.

Example warning:

```text
Duplicate security header assignment detected

Method: GET
Path: /api/orders
Header: X-Frame-Options
```

---

## Production Behavior

In production environments:

- Duplicate header detection is disabled.
- No warnings are logged.
- The middleware has no impact on application performance or response behavior.

---

## Why This Middleware Exists

Duplicate security header assignments can occur when multiple middleware components or application code configure the same header.

This middleware helps developers:

- Detect conflicting security configurations.
- Prevent accidental overwriting of security headers.
- Identify redundant middleware.
- Improve security configuration consistency during development.

---

## Relationship with Helmet

Helmet remains responsible for configuring security headers.

This middleware does **not** add, remove, or modify any headers. It only observes calls to `res.setHeader()` and reports duplicate assignments for monitored security headers.

---

## Extending the Middleware

To monitor additional security headers:

1. Add the header name to the monitored header list in `securityHeaderDuplicates.js`.
2. Add or update unit tests.
3. Update this documentation.

---

## Testing

Automated tests verify that:

- A monitored header assigned once does not generate a warning.
- Duplicate assignments of monitored headers generate a warning.
- Duplicate assignments of non-monitored headers are ignored.
- Production mode disables duplicate detection.