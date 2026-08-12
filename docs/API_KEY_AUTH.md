# API Key Authentication Middleware

## Overview

The Truxify backend includes an API key middleware (`requireApiKey`) that authenticates backend-to-backend requests using the `x-api-key` header (or `api_key` query parameter).

It is used for internal B2B endpoints such as the escrow circuit-breaker routes consumed by the n8n workflow.

---

## Location

Middleware:

```
backend/api/src/middleware/apiKey.js
```

---

## Configuration

| Variable | Description |
|----------|-------------|
| `VALID_API_KEYS` | Comma-separated list of accepted API keys |

Multiple keys are supported so keys can be rotated with zero downtime: add the new key, deploy, then remove the old key.

---

## Behavior

- If `VALID_API_KEYS` is not configured, the middleware returns `503 Service Unavailable` (fail closed — no internal endpoints are exposed unauthenticated).
- If the presented key is missing or not in the allowed list, the middleware returns `401 Unauthorized` and records a Sentry warning with the source IP and path.
- If the key matches, the request proceeds.

---

## Request Examples

```
GET /api/internal/escrow-velocity
x-api-key: <key>
```

```
GET /api/internal/pause-escrow?api_key=<key>
```

---

## Why It Exists

Internal operational endpoints must never be reachable by anonymous clients. A shared API key (as opposed to user JWTs) is the right fit for machine-to-machine callers such as workflow automations.

---

## Testing

Automated tests verify:

- Missing keys return 401.
- Invalid keys return 401.
- Valid keys are accepted.
- Unconfigured `VALID_API_KEYS` returns 503.
