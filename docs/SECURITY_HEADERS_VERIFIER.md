# Security Headers Verification Middleware

## Overview

The Truxify backend includes a development-only middleware that verifies expected security headers are present on HTTP responses.

The middleware is intended to help developers identify missing or misconfigured security headers during development without changing application behavior in production.

---

## Location

Middleware:

```
backend/api/src/middleware/securityHeadersVerifier.js
```

Registration:

```
backend/api/src/index.js
```

---

## Verified Headers

The middleware checks for the presence of the following response headers:

- `X-Content-Type-Options`
- `Referrer-Policy`
- `Permissions-Policy`
- `Cross-Origin-Resource-Policy`

---

## Development Behavior

When running in a non-production environment:

- Each response is inspected after it has been generated.
- Missing security headers are detected.
- A warning is written to the application logger.
- Requests are **not blocked**.
- Responses are **not modified**.

Example warning:

```text
Missing expected security headers

Method: GET
Path: /api/orders
Missing Headers:
- Permissions-Policy
```

---

## Production Behavior

In production environments:

- Header verification is skipped.
- No warnings are logged.
- Application behavior remains unchanged.

---

## Why This Middleware Exists

The middleware provides an additional safety check to help developers:

- Detect accidental removal of important security headers.
- Verify Helmet configuration after security-related changes.
- Identify missing headers during development before deployment.
- Reduce configuration mistakes without affecting runtime performance.

---

## Relationship with Helmet

The middleware does **not** add or modify security headers.

Security headers should continue to be configured through the existing Helmet configuration in:

```
backend/api/src/index.js
```

The verifier only checks whether those headers are present and reports missing ones during development.

---

## Extending Verification

To verify additional security headers:

1. Add the header name to the `REQUIRED_HEADERS` list in `securityHeadersVerifier.js`.
2. Update Helmet configuration if necessary.
3. Add or update automated tests.
4. Update this documentation.

---

## Testing

Automated tests verify that:

- No warnings are logged when all required headers are present.
- Missing headers generate development warnings.
- Production mode skips verification.
- Existing response behavior is unchanged.