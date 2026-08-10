# Health Check Framework

The health check framework drives `/health`, `/ready`, and `/full` reporting.

## Core modules

- `src/core/health/HealthCheck.js` — `HealthStatus` constants, `withTimeout`,
  and `executeCheck` (timing + timeout + error mapping).
- `src/core/health/HealthAggregator.js` — runs registered checks concurrently
  and builds the unified response + summary.

## Registered checks

| Check           | Critical | Notes                                        |
| --------------- | -------- | -------------------------------------------- |
| `supabase`      | yes      | Profiles table probe.                        |
| `postgres`      | yes      | `SELECT 1` on the direct pool.               |
| `mongodb`       | yes      | `admin().ping()`.                            |
| `redis`         | no       | `PING` must return `PONG`.                   |
| `firebase`      | no       | Degraded when not configured.                |
| `kafka`         | no       | Degraded when not configured/disconnected.   |
| `graphql`       | no       | Apollo health endpoint probe.                |
| `ml_engine`     | no       | `/health` probe with 3s timeout.             |
| `polygon`       | no       | `eth_blockNumber` JSON-RPC probe.            |
| `escrow`        | no       | `checkEscrowHealth()` result mapping.        |
| `workers`       | no       | Fails closed when no workers are registered. |
| `websocket`     | no       | WS server presence.                          |

## Overall status

- Any critical check unhealthy -> `unhealthy`.
- Any non-critical degraded/unhealthy -> `degraded`.
- Otherwise -> `healthy`.

## Adding a check

```js
export default function myHealth(opts) {
  return executeCheck('my_service', check, { critical: false, timeoutMs: 3000, ...opts });
}
```

Then register it in the aggregator setup with a `name`.
