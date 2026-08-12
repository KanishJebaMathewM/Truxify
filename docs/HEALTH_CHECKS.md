# Health Check System

## Overview

The Truxify backend exposes dependency health checks (`core/health/`) that probe Postgres, Redis, MongoDB, Kafka, Supabase, the Polygon RPC, WebSocket state, and background workers. An aggregator combines the per-dependency results into an overall status.

---

## Location

```
backend/api/src/core/health/HealthCheck.js       — status constants + executeCheck
backend/api/src/core/health/HealthAggregator.js  — combined status
backend/api/src/core/health/checks/             — per-dependency probes
backend/api/src/routes/healthRoutes.js          — public endpoints
```

---

## Status Values

| Status | Meaning |
|--------|---------|
| `healthy` | Dependency responding normally |
| `degraded` | Dependency reachable but not fully functional (e.g. Kafka not connected) |
| `unhealthy` | Dependency failing or not configured |
| `unknown` | Check did not report |

---

## Per-Dependency Checks

- **Postgres** — `SELECT 1` probe with pool counts.
- **Redis** — `PING` expecting `PONG`.
- **MongoDB** — `admin().ping()`.
- **Supabase** — service-role profile probe (anon is revoked by schema).
- **Polygon** — `eth_blockNumber` JSON-RPC probe with URL redaction.
- **Kafka** — config connection state.
- **GraphQL** — Apollo health endpoint.
- **WebSocket / Workers** — registered runtime state (fail closed when nothing registered).

Each check runs with a timeout and records response time; slow checks log a warning. `critical` checks degrade the overall status when they fail.

---

## Why It Exists

A single health endpoint gives orchestration (Kubernetes probes, load balancers) and operators one place to see which dependency is down, instead of scattering checks across services.

---

## Testing

Automated tests verify:

- Each dependency check's healthy/degraded/unhealthy paths.
- Not-configured handling.
- Aggregation of critical and non-critical checks.
