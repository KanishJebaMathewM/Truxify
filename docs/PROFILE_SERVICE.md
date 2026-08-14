# Profile Service

## Overview

The Truxify backend serves and mutates user profiles through a service layer (`services/profileService.js`) that keeps cached profile data consistent with the database.

---

## Location

```
backend/api/src/services/profileService.js
```

---

## Behavior

- **getProfile / getCustomerStats / getDriverDetails** — read from Redis first (`user:profile:sb:{userId}[:stats|:driver]`), falling back to Supabase on a miss, then repopulate the cache.
- **Profile updates** — mutate Supabase, then invalidate the full cached profile set (`invalidateCachedSupabaseProfileAll`) so subsequent reads never serve stale data.
- **Validation** — cached shapes are validated (`isValidCachedSupabaseProfile`) and corrupted entries are dropped and re-fetched.
- **Name lookup** — a lightweight `getProfileName` path exists for display without exposing the full profile.

---

## Why It Exists

Profiles are read on nearly every request (auth attaches the cached profile). The service centralizes read/write/invalidate so the cache never diverges from the database, and it keeps the mutation surface (which fields are writable) in one place.

---

## Testing

Automated tests verify:

- Cache hit/miss/repopulation.
- Invalidation after updates.
- Corrupted cache-entry recovery.
- Stats/driver-details sub-caches.
