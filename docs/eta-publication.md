# ETA calculation publication

## Persistence guarantee

`calculateInitialEtaAfterAssignment`, `maybeRecalculateEtaOnLocationUpdate` and the
tracker-mounted `DeliveryDelayService.processLocation`
claim an opaque PostgreSQL UUID generation before routing. The mounted tracker
calls `scheduleEtaRecalculationOnLocationUpdate`. The initial scheduling/calculation
helpers currently have no production assignment caller; this change preserves
those exports without adding lifecycle wiring.

`claim_order_eta_generation` replaces the current generation only when the order
still matches the driver, expected lifecycle status and active ETA statuses.
`commit_order_eta_generation` atomically checks that same generation, driver,
status and the persisted arrival change threshold while updating the ETA row.
PostgreSQL's conditional UPDATE serializes competing writers on the row and
rechecks its predicate after waiting. A newer claim prevents an older generation
from overwriting its ETA. A driver/status change observed at commit rejects the
estimate even if routing already completed. A driver-change trigger clears the
current generation and arrival epoch, so the first new-driver estimate is not
suppressed by the former driver’s threshold, and switching back cannot revive an
old claim. An update that retains the same driver preserves threshold state. An unsuccessful newer calculation
still supersedes an older one; it does not revive that older estimate.

Arrival epochs persist with the ETA; loss of the advisory Redis arrival cache
cannot bypass the 120-second default threshold. Existing rows have a NULL epoch,
so their first admitted calculation initializes it. UUIDs are compared as strings
in JavaScript, avoiding number rollover. Claims and commits preserve existing
invoker/RLS/table privileges and grant function execution only to service_role.
No table policy or caller privilege is widened.

The delivery-delay writer claims the same generation before its independent
routing call. Its conditional table UPDATE checks the generation, driver and
exact lifecycle status alongside the existing previous-ETA/delay-state CAS.
It writes its ISO ETA and durable arrival epoch together. This prevents either
mounted writer from overwriting a newer generation from the other. The legacy
`active` status remains admitted for delivery delay. Missing ownership makes
`updateDeliveryEtaState` return no row; there is no unguarded fallback. Failed
claims skip routing, writes and pushes. Before a delay/recovery push, a fresh
ownership read suppresses known supersession or read failure. An already-started
push can finish late, and a committed state transition may have no push. Existing
ISO delivery-delay payloads and human-readable location ETA payloads remain as
before; this protocol does not unify their formats or change delay evaluation.


## Publication and failure limits

A failed/rejected commit never starts arrival-cache, broadcast or movement writes.
Fresh database reads suppress continuations when they observe a newer generation,
driver or status (including after the awaited advisory cache write). Initial ETA
now records movement only following accepted publication, as location ETA does.
Redis absence/failure affects movement admission/cache efficiency, not persisted
ownership. Database or missing-RPC errors safely skip calculation/publication;
there is no legacy unguarded update fallback.

These reads are **best-effort continuation suppression**, not a transaction with
Redis or WebSocket/Socket.IO. A successor may claim after a fresh read. An already
started Redis write or external delivery can complete late, and Redis advisory
positions/arrival epochs can therefore be out of order across processes. Socket
messages remain the existing display-ID/text payload without client sequence
acknowledgments. Delivery is neither durable nor globally ordered nor exactly
once. A committed ETA can remain without a broadcast following a read/transport
failure or a lost RPC response. Retried claims obtain a new UUID; commit retries
may be rejected by the durable arrival threshold after an earlier attempt already
committed. No upstream provider or Redis call is newly made cancellable.

The exported scheduling wrappers still return immediately and contain errors;
ETA text and realtime argument shapes are unchanged. Direct internal users of
`persistAndBroadcastEta` must supply the database generation and assigned driver;
a missing generation fails closed. No other production consumer of this helper
was found. Threshold/movement configuration and compatibility helper exports
remain available; the old Redis calc-token namespace is no longer authoritative.

## Rollout and rollback

1. Stop admission and drain **all old ETA workers/API instances**. Old versions
   use an unguarded table update and can defeat the protocol during mixed-version
   operation; deploying this migration alone does not fence them.
2. Apply `20261002174206_eta_calculation_generation.sql` to the canonical orders
   schema before starting new instances. Refresh the PostgREST schema cache using
   the deployment's normal migration procedure and verify both RPCs are visible
   to the backend's existing service-role repository client.
3. Start new instances and check claims/commits and ETA delivery. Migration
   reapplication preserves values; it introduces no live backfill or provider call.
4. Rollback requires stopping/draining new instances before returning to old
   code. Nullable additive columns/functions can remain. Old code restores the
   former race; never describe a mixed fleet as fenced.

## Verification

```sh
npm ci --prefix tools/eta-publication-tests --no-fund
bash tools/eta-publication-tests/run.sh
```

The locked runner copies entire actual service/repository files unchanged into a
temporary tree. Provider, database transport, logging, geographic distance and
retry/measurement/request-context imports are controlled seams; actual RPC argument
mapping and service entry points execute real PostgreSQL in PGlite. The test
schema models canonical orders columns and roles; it is not a complete Supabase
migration replay or live PostgREST/production RLS deployment test. PGlite is a
single local engine, so tests demonstrate deterministic protocol interleavings,
not independent-session PostgreSQL lock contention. Existing repository lifecycle,
transactional outbox and lookup tests also run. No remote provider is contacted.
Scoped ESLint runs against all changed production files and the protocol fixture.
The dedicated GitHub workflow uses the same lock and runner; the full monorepo
suite is a separate gate with existing unrelated failures.
