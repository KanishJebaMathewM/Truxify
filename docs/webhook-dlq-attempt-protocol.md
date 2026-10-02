# Webhook DLQ attempt admission and settlement

The current claim RPC already increments `attempt_count` on each claim or reclaim. The API now carries that generation through admission, completion, retry and permanent failure. Each new RPC locks the event row, then evaluates `clock_timestamp()` and exact `(id, processing status, worker, attempt_count, live lease)` ownership. Lock wait and an earlier transaction start cannot extend an expired attempt's authority. Missing/invalid generations do not fall back to worker-name-only updates.

`processQueue` validates and renews a live attempt before invoking each sequential batch handler. A queued item that expired or was reclaimed is counted as `lost` without calling its handler. The original claim RPC, enqueue deduplication, retry schedule, business processor, summary fields and worker polling loop are retained. New settlement clears `next_retry_at` for terminal states. Database settlement failure or unknown/malformed RPC results return lost ownership; they never trigger legacy unguarded updates.

## Rollout

1. Apply `supabase/migrations/20261002164243_webhook_dlq_attempt_fencing.sql` through the normal reviewed migration process before deploying the API.
2. Verify both functions are visible in the PostgREST schema cache and executable by the backend service role. Refresh the schema cache through the existing deployment procedure if required.
3. Drain old API workers before enabling new replicas: old code retains its unguarded update implementation. Mixed-version operation does not guarantee fenced settlement.
4. Deploy the new API; verify normal queue completion and monitor lost admissions/RPC failures. No live migration or provider action is performed by this PR.

The additive migration does not replace the claim RPC, create tables, or alter table grants/policies. The new functions use SECURITY INVOKER, a qualified relation/empty search path, and service-role-only execution. Existing service-role table access and RLS remain authoritative. A missing migration/RPC prevents handler admission; claimed rows remain available for normal expiry/reclaim. Rollback to old API code loses the new fencing property.

## Limits

This remains an at-least-once processing system. An admission check can only describe ownership at its database transaction; expiry or reclaim can occur after it returns. A lease cannot cancel an already-started provider/database handler. A handler that outlives its lease may execute business effects but cannot settle the expired attempt. Provider/business idempotency is still required; this protocol does not establish exactly-once effects. No heartbeat or handler abort/deadline is added here. Slow sequential batches can lose remaining items, which are then recovered through existing expiry/reclaim.

The original claim RPC's policies, time semantics, batch and crash-loop behavior are retained. PGlite tests use the real SQL and actual service but do not prove multi-process PostgreSQL lock scheduling or live PostgREST transport behavior. Production advisors and a live environment rollout remain deployment gates.

## Verification

```sh
cd tools/dlq-attempt-tests
npm ci --no-fund
cd ../..
bash tools/dlq-attempt-tests/run.sh
```

The isolated locked harness executes actual DLQ source and migrations. Its PostgreSQL fixture lives under tools/dlq-attempt-tests/fixtures and is materialized into the temporary API test tree, so ordinary API discovery does not require a new PGlite dependency. Database/provider imports are controlled by test mocks; actual escrow business processing is not invoked. Database-backed tests run in-memory PostgreSQL/PGlite, including stale generations, expired/missing leases, normal transitions, same-worker reclaim, queued admission loss and database-clock behavior inside an earlier-started transaction. Existing DLQ service and worker lifecycle fixtures also run. This focused check does not claim the entire monorepo suite is green.
