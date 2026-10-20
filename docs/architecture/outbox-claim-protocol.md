# Active event outbox relay lease protocol

The relay uses the canonical `event_outbox` queue. Admission, renewal and
completion use PostgreSQL RPCs rather than client-side read/modify/write.

- `claim_leased_outbox_events(limit, lease_ms)` locks due pending rows or expired
  publishing rows with `FOR UPDATE SKIP LOCKED`, increments attempts exactly
  once, and returns that attempt as the claim generation. Live claims stay
  exclusive. The configured relay lease is now honored (default five minutes).
- `renew_leased_outbox_event(event_id, attempt, lease_ms)` extends only a still
  live, current claim. The relay calls it immediately before dispatching each
  batch item, preventing an expired/reclaimed item from starting publication.
- `settle_leased_outbox_event(event_id, attempt, published, error, retry_ms)`
  changes a row only if its status, generation and live lease match. Stale
  success/failure returns false and leaves the newer claim unchanged. Failure
  schedules bounded exponential delay; admission observes that due time.

All three RPCs use invoker permissions, a fixed search path, and execution
restricted to service_role. A missing migration/database error fails closed;
there is no unfenced acknowledgement fallback.

The relay no longer calls the unconditional publishing-row requeue at the
start of every cycle. The compatibility requeue method only touches expired
claims. Successful external delivery is logged as published only after an
accepted database acknowledgement. EventBus envelopes retain event_outbox's
stable event_id; the relay bypasses process-local EventBus deduplication so a
failed delivery can be retried. Downstream consumers must remain idempotent.

## Operational boundaries

Apply the forward migration before starting updated relay workers, and replace
all old relay replicas: old binaries still contain unsafe requeue/completion
logic. No migration or deployment is performed by this contribution. Admission
uses database time; the old compatibility requeue helper uses the caller clock
and is not used by the active relay.

Kafka delivery remains at-least-once. A publication already in flight can outlast
its lease, and a crash after broker delivery but before acknowledgement can
produce a replay. This change does not add periodic renewal for an indefinitely
blocked broker call or claim exactly-once external effects. Row-lock behavior
uses PostgreSQL SKIP LOCKED; local PGlite tests run interleaved claims, not a
multi-process PostgreSQL load test.

Legacy outbox_events/outbox_dlq dead-letter and replay methods are a separate
pipeline and remain unchanged; this contribution does not claim to unify or
repair their retry-budget/dead-letter behavior. Pending #16794 edits the old
failure counter path; its overlap should be reviewed when merging this protocol.

## Verification

```sh
npm ci --prefix supabase/tests --ignore-scripts
npm test --prefix supabase/tests
```

The pinned PGlite fixture executes the actual canonical table/RLS SQL and this
forward migration. It covers live and expired leases, stale success/failure,
retry timing, configured duration, renewal, repeatable migration and internal
role permissions. Dedicated GitHub CI runs these tests. Backend service/worker
tests also cover RPC token forwarding, skipped stale dispatch, delivery errors,
stable envelope identity and rejected acknowledgement reporting.


## Polling lifecycle

Each start owns its interval callbacks. Stop invalidates that generation, so a
captured old callback cannot admit another database batch after stop or restart.
The existing process-local running guard remains held until an admitted native
cycle settles, including across stop/restart. Stop is synchronous and does not
cancel or drain an already started batch; that batch retains exact-attempt
database fencing. An indefinitely blocked native cycle continues to block local
admission. Two stale-callback regressions fail on the old worker, and a third
check preserves the existing non-overlap behavior through restart.
