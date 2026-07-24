# Cache-Control Verification Middleware

## Overview

The Truxify backend includes a development-only middleware that verifies authenticated responses include appropriate cache-control headers.

The middleware helps developers identify responses that may unintentionally be cached by browsers or intermediate proxies without modifying application behavior.

---

## Location

Middleware:

```
backend/api/src/middleware/cacheControlVerifier.js
```

Registration:

```
backend/api/src/index.js
```

---

## Verified Headers

The middleware checks authenticated responses for:

- `Cache-Control`
- `Pragma`
- `Expires`

It also verifies that the `Cache-Control` directive is appropriate for sensitive responses.

---

## Development Behavior

When running in a non-production environment:

- Authenticated responses are inspected after completion.
- Missing cache-control headers generate warnings.
- Potentially cacheable responses generate warnings.
- Responses are not modified.
- Requests continue normally.

Example warning:

```text
Authenticated response may be cacheable

Method: GET
Path: /api/profile
Missing Headers:
- Cache-Control
- Pragma
- Expires
```

---

## Production Behavior

In production environments:

- Verification is disabled.
- No warnings are logged.
- Response behavior is unchanged.

---

## Why This Middleware Exists

Sensitive authenticated responses should generally avoid being cached by browsers or shared caches.

This middleware helps developers detect:

- Missing cache-control directives.
- Public cache policies on authenticated endpoints.
- Configuration regressions during development.

---

## Relationship with Existing Routes

This middleware does not modify response headers.

Routes remain responsible for setting their own cache policies. The verifier only checks the final response and reports potential issues during development.

---

## Extending Verification

Future enhancements may include:

- Route-specific cache policies.
- Different requirements for public and private endpoints.
- Configurable verification rules.

---

## Testing

Automated tests verify:

- Valid cache headers do not generate warnings.
- Missing headers generate warnings.
- Cacheable authenticated responses generate warnings.
- Production mode disables verification.