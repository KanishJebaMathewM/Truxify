# Cache System

## Overview

The Truxify backend has a namespaced, versioned Redis cache system (`backend/api/src/cache/`) with cross-instance invalidation via Redis Pub/Sub.

---

## Location

```
backend/api/src/cache/CacheNamespace.js   — namespace registry
backend/api/src/cache/CacheKeyBuilder.js  — versioned key building
backend/api/src/cache/CacheManager.js     — facade (get/set/invalidate/stats)
backend/api/src/cache/CachePublisher.js   — Pub/Sub invalidation fan-out
backend/api/src/cache/CacheInvalidator.js — local + remote invalidation
backend/api/src/cache/CacheEvent.js       — invalidation event types
```

---

## Namespaces

Every cached entity must be registered in `CacheNamespace` (e.g. `profile`, `order`, `driver`, `osrm`, `load_offer`). Namespaces isolate keys so pattern-based invalidation targets one domain without collateral damage.

## Keys

`CacheKeyBuilder.build(namespace, entityId, subKey)` produces `{prefix}:{entityId}[:{subKey}]`. Versioned keys (`buildVersioned`) read a live version counter from Redis, so bumping the version invalidates every key under that namespace+entity.

## Facade

`CacheManager` provides `get`, `set`, `invalidate`, `invalidateBatch`, `bumpVersion`, `getVersion`, and stats (`hits`, `misses`, `sets`, `deletes`, `errors`). It wires the Redis client into the key builder and initializes the publisher/invalidator.

## Invalidation

- `invalidateKey` / `invalidatePattern` / `invalidateNamespace` clear local keys.
- `CachePublisher` publishes invalidation events on `cache:invalidate:{namespace}` channels; every replica applies them (skipping self-originated events).
- Event types: `INVALIDATE_KEY`, `INVALIDATE_PATTERN`, `INVALIDATE_NAMESPACE`, `BUMP_VERSION`, `REFRESH`.

---

## Why It Exists

Caching is useless if replicas serve stale data. The namespaced, versioned design keeps keys auditable, and Pub/Sub invalidation keeps every replica consistent without polling.

---

## Testing

Automated tests verify:

- Namespace registration/lookup.
- Key building, versioned keys, and parsing.
- CacheManager get/set/stats.
- Invalidation event semantics.
