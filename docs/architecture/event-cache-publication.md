# Event-store cache publication

`EventStoreCore` has separate process-local caches for complete event streams
and validated snapshots (including a successfully read absent snapshot).
Each cache also tracks the current in-flight load for an aggregate.

## Ownership and invalidation

A cache miss installs an owner object before starting persistence I/O. Concurrent
misses join that owner's promise. A successful result publishes only if its owner
still occupies the slot. The owner is removed on success or failure, and an old
owner cannot remove a replacement load during cleanup.

`clearCache(id)` removes both cached values and current read owners for that
aggregate. `clearCache()` does the same for all aggregates. This revokes older
loads without accumulating per-key generation counters. Revocation does not
cancel the underlying persistence request. A superseded successful read joins
its replacement or rereads persistence if there is no current value or load.

## Committed writes

- Appends change cache state only after persistence succeeds. An append revokes
  an older event-stream load. A cold cache remains cold: a single appended event
  is insufficient to reconstruct unread history.
- A complete warm stream can be extended if the appended version immediately
  follows its last version. Otherwise the stream is invalidated and reloaded;
  a different instance may have committed an intervening event. Already returned
  arrays are not mutated by later appends.
- Successful snapshot persistence revokes older snapshot reads before publishing
  the written snapshot. Failed writes preserve the existing cache.
- Failed stream reads reject; failed snapshot reads retain the existing logged
  full-replay fallback and return null without caching failure as absence.

## Limits

This is local publication ownership, not a distributed consistency protocol.
External writers do not automatically invalidate a warm cache. Explicit refresh
is still required; concurrent snapshot writes still use the adapter's existing
persistence ordering. Stream and snapshot reads do not share a database
transaction. Continuous invalidation can prolong a read through repeated reloads.
Existing cache size, TTL, and snapshot-trigger policies are unchanged. No database
migration or new runtime dependency is required.

## Verification

```sh
node --test backend/eventsourcing/test/cache-publication.test.js backend/eventsourcing/test/event-sourcing-core.test.js
```

Tests use the actual core and persistence contract with promise-controlled I/O
interleavings, including successful and failed superseded loads, both cache-clear
forms, independent keys, cold append history, intervening external versions,
snapshot writes, and 40 concurrent callers sharing one database read.
