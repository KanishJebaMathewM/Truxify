# Sentry Middleware

## Overview

The Truxify backend integrates Sentry for error tracking and alerting. The Sentry middleware captures request context, attaches it to error reports, and scrubs sensitive data before events leave the server.

---

## Location

Middleware:

```
backend/api/src/middleware/sentry.js
```

---

## Behavior

- Initializes the Sentry SDK with the DSN from configuration.
- Captures unhandled errors with request context (request ID, user ID, URL, method).
- Adds breadcrumbs for significant request lifecycle steps.
- **Scrubs sensitive fields** — authorization headers, tokens, passwords, and OTPs are removed from breadcrumbs and event extras so credentials never reach the Sentry dashboard.

---

## Environment

Sentry is only active when a DSN is configured (via `SENTRY_DSN` or the Sentry configuration module). Without a DSN the middleware degrades to a no-op so local development and tests are unaffected.

---

## Why It Exists

Error tracking is only useful if reports carry enough context to reproduce the failure — and only safe if they carry no secrets. The middleware provides that context while the scrubber guarantees the latter.

---

## Testing

Automated tests verify:

- The middleware attaches request context to captured events.
- Authorization tokens and other secrets are scrubbed from events.
- Unconfigured DSN results in a no-op.
