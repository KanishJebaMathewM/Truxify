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
| `ESCROW_OPERATOR_API_KEY` | Dedicated escrow operator key; required *in addition to* a key from `VALID_API_KEYS` to close the escrow circuit breaker (must also be listed in `VALID_API_KEYS`) |

Multiple keys are supported so keys can be rotated with zero downtime: add the new key, deploy, then remove the old key.

---

## Escrow Operator Authorization

Some internal endpoints distinguish a dedicated **operator key** from the shared
internal keys. Closing the escrow circuit breaker —
`POST /api/internal/pause-escrow` with `{"paused": false}` — re-enables on-chain
escrow submissions, so it requires the key designated by
`ESCROW_OPERATOR_API_KEY` to be presented in the same `x-api-key` header that
`requireApiKey` authenticates.

- Any other valid `VALID_API_KEYS` key is answered `403 Forbidden` and the circuit
  breaker is not touched. This includes keys that only read telemetry or trigger
  automation.
- Opening the circuit (`{"paused": true}` or an empty body) keeps the plain
  `requireApiKey` behavior — no operator key required.
- Fails closed: when `ESCROW_OPERATOR_API_KEY` is not configured, unpause attempts
  are refused with `403`.
- The operator key is compared with the timing-safe `safeCompare` helper and is
  never logged.
- The dedicated key must be a member of `VALID_API_KEYS` so `requireApiKey`
  authenticates it before the route-level operator check runs.

Example:

```
POST /api/internal/pause-escrow
x-api-key: <escrow-operator-key>
Content-Type: application/json

{"paused": false}
```

---

## Behavior

- If `VALID_API_KEYS` is not configured, the middleware returns `503 Service Unavailable` (fail closed — no internal endpoints are exposed unauthenticated).
- If the presented key is missing or not in the allowed list, the middleware returns `401 Unauthorized` and records a Sentry warning with the source IP and path.
- If the key matches, the request proceeds.
- Escrow pause and unpause operations additionally require a key from `ESCROW_OPERATOR_API_KEYS`; a valid reader or workflow key cannot reopen escrow.

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
