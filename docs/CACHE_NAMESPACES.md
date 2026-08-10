# Cache Namespaces

Centralized registry of Redis cache namespaces used by `CacheKeyBuilder`,
`CacheNamespace`, and the cache invalidation system.

## Registered namespaces

| Namespace     | Prefix        | Default TTL | Pub/Sub |
| ------------- | ------------- | ----------- | ------- |
| `profile`     | `user:profile`| 900s (env `REDIS_CACHE_TTL`) | yes |
| `order`       | `order`       | 300s        | yes |
| `driver`      | `driver`      | 300s        | yes |
| `lookup`      | `lookup`      | 3600s       | yes |
| `osrm`        | `osrm`        | 86400s      | yes |
| `fraud`       | `fraud`       | 3600s       | yes |
| `idempotency` | `idempotency` | 3600s       | yes |
| `shard`       | `shard`       | 300s        | yes |
| `rate_limit`  | `rate_limit`  | 900s        | no  |
| `lock`        | `lock`        | 10s         | no  |
| `tracker`     | `tracker`     | 86400s      | yes |
| `load_offer`  | `load_offer`  | 120s        | yes |
| `otp`         | `otp`         | 3600s       | no  |
| `version`     | `version`     | 0s          | no  |

## Key formats

- Unversioned: `{prefix}:{entityId}[:{subKey}]`
- Versioned: `{prefix}:v{version}:{entityId}[:{subKey}]`
- Version counter: `{prefix}:version:{entityId}`
- Pub/Sub channel: `cache:invalidate:{namespace}`

## Usage

Register new domains in `CacheNamespace.register(...)` before using them;
pattern-based invalidation (SCAN) relies on the registry staying accurate.
