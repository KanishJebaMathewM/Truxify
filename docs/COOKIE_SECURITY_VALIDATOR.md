# Cookie Security Validation Middleware

## Overview

The Truxify backend includes a development-only middleware that validates outgoing HTTP cookies for recommended security attributes.

The middleware inspects `Set-Cookie` response headers and logs warnings when important security attributes are missing. It is intended to help developers identify insecure cookie configurations during development without modifying application behavior.

---

## Location

Middleware:

```
backend/api/src/middleware/cookieSecurityValidator.js
```

Registration:

```
backend/api/src/index.js
```

---

## Validated Cookie Attributes

The middleware checks for the following cookie attributes:

- `HttpOnly`
- `SameSite`
- `Path`

Additionally, in production environments, cookies should also include:

- `Secure`

---

## Development Behavior

When running in a non-production environment:

- Outgoing `Set-Cookie` headers are inspected.
- Cookies missing recommended security attributes are identified.
- A warning is written to the application logger.
- Cookies are **not modified**.
- Responses continue normally.

Example warning:

```text
Cookie missing recommended security attributes

Method: POST
Path: /api/login
Missing Attributes:
- HttpOnly
- SameSite
- Path
```

---

## Production Behavior

In production environments:

- Cookie validation middleware performs no logging.
- No cookies are modified.
- Application behavior remains unchanged.

---

## Why This Middleware Exists

Secure cookie attributes help reduce common web security risks such as:

- Cross-Site Scripting (XSS)
- Cross-Site Request Forgery (CSRF)
- Cookie theft
- Session fixation

This middleware helps developers identify missing cookie security attributes before deployment.

---

## Current Repository Behavior

The middleware is passive and only validates cookies if the application sets `Set-Cookie` response headers.

If no cookies are issued by the application, the middleware performs no action and introduces no functional changes.

---

## Extending Validation

To validate additional cookie attributes:

1. Update the validation logic in `cookieSecurityValidator.js`.
2. Add corresponding unit tests.
3. Update this documentation.

Possible future checks include:

- `Domain`
- `Max-Age`
- `Expires`
- Cookie prefixes (`__Host-`, `__Secure-`)

---

## Testing

Automated tests verify:

- No warnings when no cookies are present.
- Cookies with recommended attributes do not generate warnings.
- Missing attributes generate development warnings.
- Production mode does not log warnings.