# Lookup Routes

Public lookup endpoints for reference data, served with a two-tier cache.

## GET /api/lookup/vehicle-types

Returns the list of supported vehicle types.

## GET /api/lookup/regions

Returns the list of supported regions.

### Caching

Responses are cached in two tiers:

- **L1** — in-memory LRU (max 1000 keys, 5 minute TTL).
- **L2** — Redis (1 hour TTL), when `redisClient` is configured.

An in-flight request map ensures a cache stampede cannot hit the database
multiple times for the same key; only the first caller fetches, the rest
await the same promise.

### Errors

| Status | Meaning                          |
| ------ | -------------------------------- |
| 200    | `{ data: [...] }`                |
| 500    | `{ error: "Failed to fetch ..." }` |
