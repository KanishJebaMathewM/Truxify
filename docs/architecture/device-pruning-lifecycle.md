# Scheduled device pruning lifecycle

The scheduled worker soft-deactivates stale **active** `user_devices` records.
The manual notification-service prune operation deletes long-inactive records;
that endpoint and its authorization are separate and unchanged.

## Batch ownership

A run retains its process-local running flag until all already-dispatched
operations and final cleanup settle. Database/Redis clients are captured for the
run so a module-level client replacement does not switch its ownership domain. Concurrent local invocations return. Stop
only stops scheduling; it does not falsely release ownership of pending work.

With Redis configured, a run claims `device:pruning:lock` using a random UUID and
`SET NX EX` with a 600-second lease. It atomically compares the UUID and renews
expiry before each candidate query, then again before dispatching its update.
A missing owner, renewal error or expired/replaced lease ends the run. Final
cleanup atomically compares the UUID before deletion, preserving successor
leases. No lease-loss path reacquires ownership within that run.

Without Redis, the same local running flag permits process-local operation;
there is no cross-replica mutual exclusion guarantee.

## Bounded draining and freshness

One cutoff is computed per run. Each batch selects active rows older than that
cutoff, ordered by `last_seen` then `id`, with a bounded limit. The UPDATE checks
ID membership, active status **and** the same cutoff. Registration or successful
notification that refreshes `last_seen` before the UPDATE is evaluated preserves
that device. Returned IDs count actual changes rather than selected candidates.

The next batch queries the first eligible page again. Deactivated and refreshed
rows no longer match, so no offset can skip remaining rows in the mutating set.
Empty reads, database errors or the batch cap stop processing. If rows cannot be
updated and remain eligible, the cap still prevents an endless drain.

| Setting | Default | Maximum | Meaning |
| --- | ---: | ---: | --- |
| `DEVICE_STALE_THRESHOLD_DAYS` | 90 | 3,650 | Staleness cutoff age |
| `DEVICE_PRUNE_BATCH_SIZE` | 200 | 1,000 | Candidate IDs per batch |
| `DEVICE_PRUNE_MAX_BATCHES` | 10 | 100 | Update batches per run |

Positive finite settings are floored and capped; invalid/nonpositive values use
the defaults. Normal default capacity increases from one 200-row batch to at
most ten batches (2,000 candidates); remaining backlog waits for a future run.
Queries use the existing active/last_seen index. No migration is introduced.

## Limits

Redis renewal and PostgreSQL UPDATE are not one transaction. An update already
dispatched before lease loss can still complete; the stale/active SQL predicate
is its safety boundary. This is not cross-database exactly-once processing or
transactional fencing. No native cancellation or absolute database operation
deadline is claimed; a hung operation retains the local running guard until it
settles. Redis itself releases expired leases. There is no provider/deployment
change, deletion, auth-policy change or production database action.

## Verification

Run `npm ci --prefix tools/device-pruning-tests --ignore-scripts --no-audit --no-fund`
and `bash tools/device-pruning-tests/run.sh` from repository root. The locked
harness copies the actual worker, tests, helper and repository lint rules into
an isolated temporary tree, mocking only database/Redis/cron/tracing/logging
boundaries. It does not transform the production worker. The temporary tree is
removed by its own cleanup trap.

22 tests pass: 18 new lifecycle cases plus four existing worker tests. Twelve
new tests fail against actual unchanged main, as does the adjusted cleanup
expectation in one existing test. Freshness is additionally verified by running
the actual worker's query-builder predicates against PGlite 0.5.8 (real
PostgreSQL-compatible execution, not a live Supabase/PostgREST server).
Redis lease tests use deterministic ownership doubles; they are not live Redis
integration tests. Lint and Node syntax checks pass for the worker and tests.
The full repository's unrelated CI failures are not covered by this gate.
