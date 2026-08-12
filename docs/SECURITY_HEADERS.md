# Security Headers Middleware

## Overview

The Truxify backend includes a security headers middleware that sets standard HTTP security headers on every response, while preserving any headers a route has already set.

---

## Location

Middleware:

```
backend/api/src/middleware/securityHeaders.js
```

---

## Headers Set

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Content-Type-Options` | `nosniff` | Prevent MIME-type sniffing |
| `X-Frame-Options` | `DENY` | Prevent clickjacking |
| `X-XSS-Protection` | `1; mode=block` | Legacy XSS filter |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | Enforce HTTPS (only when the request is secure) |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | Limit referrer leakage |
| `Permissions-Policy` | `geolocation=(self), camera=(self), microphone=(self)` | Restrict browser features |
| `Cross-Origin-Resource-Policy` | `same-origin` | Prevent cross-origin resource abuse |
| `X-Content-Security-Policy` | `default-src 'self'` | Baseline CSP |

Each header is only set when it is not already present, so route-level overrides are respected.

---

## Why It Exists

HTTP security headers are the cheapest browser-side defense against common attack classes (clickjacking, MIME confusion, referrer leakage). Setting them centrally ensures every response carries them without each route having to remember.

---

## Testing

Automated tests verify:

- All expected headers are present on a plain response.
- Pre-existing headers are not overwritten.
- HSTS is only set on secure requests.
