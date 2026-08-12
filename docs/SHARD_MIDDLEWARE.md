# Shard Routing Middleware

## Overview

The Truxify backend routes order data across multiple Postgres shards by geographic region. The shard middleware (`shardMiddleware`) resolves the target shard for a request from its coordinates and attaches the correct database connection.

---

## Location

Middleware:

```
backend/api/src/middleware/shardMiddleware.js
```

Shard manager:

```
backend/api/src/services/sharding/ShardManager.js
```

---

## Behavior

- Reads `lat`/`lng` from the query string or body.
- Validates that coordinates are finite and within range (lat `[-90, 90]`, lng `[-180, 180]`).
- Returns `400` for missing/invalid coordinates.
- Resolves the shard name via `shardManager.getShardForLocation(lat, lng)`.
- Attaches `req.shard` and `req.shardConnection` for downstream handlers.
- Falls back to the default shard (`north`) when no coordinates are supplied.
- Sets `X-Shard` and `X-Shard-Healthy` response headers.

### crossShardQuery

The `crossShardQuery` middleware attaches `req.executeCrossShard(query, params)` so a handler can fan a query out across every shard and aggregate the results.

---

## Why It Exists

Geographic sharding keeps each shard's dataset regional, reducing cross-region latency and keeping table sizes manageable. The middleware makes the shard selection transparent to route handlers.

---

## Testing

Automated tests verify:

- Coordinate validation and range checks.
- Shard resolution from coordinates.
- Default-shard fallback.
- Cross-shard query execution.
