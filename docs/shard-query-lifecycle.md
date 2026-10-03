# Cross-shard query lifetime

The mounted cross-shard orders route invokes `ShardManager.executeCrossShardQuery`
through `crossShardQuery` middleware. The manager dispatches all configured shards
concurrently and preserves its existing successful results, failure metadata,
merged arrays (with non-enumerable metadata), sorting and pagination.

## Owned checkout and total deadline

Every cross-shard call now uses a finite **5000ms default** total budget per shard,
including calls without `timeoutMs`. An explicit timeout must be a number that is
finite, positive and at most **30000ms**; invalid values reject before admission.
A monotonic deadline covers native `Pool.connect()` checkout/startup and SQL
execution. Query-timeout configuration alone cannot bound native pool checkout.
Initialized shard pools also use a 5000ms native connection-startup timeout;
existing shard credentials, placement and pool size10 are unchanged.

The owner checks the deadline after checkout and after query completion. A client
acquired after expiry is retired using `release(error)` without sending SQL.
A successful query uses ordinary `release()`; a query failure/deadline uses
`release(error)`, which removes/destroys the native pg client. Release is attempted
once per owned client; a failed release cannot be claimed as successful cleanup.
Native promises remain observed after the caller has returned, including late
checkout rejection and query resolution. Each caller timer is cleared on completion.

## Retained admission

At most **10 unfinished cross-shard operations per Pool instance** are admitted.
There is no additional application queue. Saturation produces a named per-shard
`ESHARDSATURATED` error; expiry produces `ETIMEDOUT`. These remain represented in
the existing `failed`/`errors`/`partial` result shape. Pool capacity is shared across
manager calls but independent between distinct pool objects.

A timed-out caller does not release its admission slot until unfinished checkout
or native query work settles. Thus custom/non-native drivers that never settle
can retain up to10 slots indefinitely and later callers fail quickly. Native
startup timeouts and destroying acquired pg clients normally settle these flights.
The native Pool may still have a bounded checkout queue when other users of the
same pool occupy its connections. Direct `executeQuery`, health checks and callers
using the raw shard connection are outside this cross-shard admission protocol.

## Limits and deployment

Closing the owned socket prevents reuse and suppresses late results. It is not a
transactional SQL cancellation or rollback acknowledgment: SQL already dispatched
may commit before the disconnect. Do not retry arbitrary writes on the assumption
that timeout means no effect, and do not claim distributed exactly-once execution.
The guarantee covers dispatch admission checks; synchronous blocking in a driver
or a stalled JavaScript event loop cannot be preempted by a timer. Foreign work
on a shared pool is not cancelled. Whole-process shutdown ordering and pool.end
behavior are unchanged.

Deploy the helper and manager together; there are no database schema, grants,
provider credentials or migration changes. Observe partial/saturation rates and
consider legitimate long-running query workloads when selecting explicit budgets.
Calls that formerly waited indefinitely now return timeout failure metadata.

## Verification

```sh
npm ci --prefix tools/shard-query-tests --no-fund --ignore-scripts
bash tools/shard-query-tests/run.sh
```

The runner copies the entire actual manager/helper unchanged into a temporary
tree, with explicit logger/config import seams. Existing geographic placement,
credential, single-shard, health/shutdown and scatter-gather tests run alongside
owned lifecycle tests. Older query-only fixtures now model checkout/release;
these tests call the actual manager and preserve their existing result assertions.
Three native pg8.22.0 tests use a loopback PostgreSQL wire fixture for delayed
startup, stalled query and successful return-to-pool. This exercises native driver,
sockets and pool ownership, not a deployed PostgreSQL query engine or transactional
cancellation. No remote database or provider is contacted. Scoped ESLint and the
locked focused GitHub workflow use the same production files and tests.
