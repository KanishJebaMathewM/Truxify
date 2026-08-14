# Profile Cache

## Overview

The Truxify backend caches user profiles in Redis to keep authentication fast and reduce database load. The profile cache (`lib/profileCache.js`) stores, reads, validates, and invalidates cached profiles for both Firebase and Supabase identities.

---

## Location

```
backend/api/src/lib/profileCache.js
```

Key builders:

```
backend/api/src/cache/profileCacheKeys.js
```

---

## Key Namespace

| Identity | Key |
|----------|-----|
| Firebase | `user:profile:{firebaseUid}` |
| Supabase | `user:profile:sb:{userId}` |

---

## Behavior

- **Get/Set**: `getCachedProfile` / `setCachedProfile` (Firebase) and `getCachedSupabaseProfile` / `setCachedSupabaseProfile` (Supabase) with default TTL `REDIS_CACHE_TTL` (120 s) and tombstone TTL 30 s.
- **Validation**: `isValidCachedProfile` / `isValidCachedSupabaseProfile` reject malformed cached shapes (wrong `uid`/`id`, non-boolean `isActive`, missing role) so corrupted cache entries cannot be served.
- **Tombstones**: an inactive profile is cached as `{ isActive: false }` briefly so deactivated accounts are not repeatedly queried.
- **Invalidation**: profile mutations call `invalidateCachedProfile` / `invalidateCachedSupabaseProfileAll`, and invalidations are broadcast over Redis Pub/Sub so every replica drops the stale entry.
- **Stats**: `getCacheStats()` / `resetCacheStats()` track hits, misses, and sets.

---

## TTL Clamping

The auth middleware clamps the cache TTL to the access token's remaining lifetime, so a cached profile can never outlive the token that authorised it.

---

## Why It Exists

Profile lookups run on every authenticated request. Caching them short-circuits the database hit, while validation, tombstones, and TTL clamping keep the cache correct even when profiles are deactivated or tokens expire.

---

## Testing

Automated tests verify:

- Cache hits, misses, and sets.
- Shape validation rejects corrupted entries.
- Tombstone caching for inactive profiles.
- Invalidation and stats accounting.
