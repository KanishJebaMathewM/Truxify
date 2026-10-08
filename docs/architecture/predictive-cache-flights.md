# Predictive-cache flight lifecycle

`MultiTierCache` retains one process-local computation flight per normalized key.
The flight covers distributed-lock acquisition, contention rechecks, emergency
fallback computation, and cache publication. Foreground misses and background
XFetch refreshes join the same current flight. Different keys remain independent.
When callers supply different callbacks or options for one key, the first active
flight determines the shared result and options, as with the existing single-flight
contract.

## Leader publication

The acquired `StampedeLock` runs a callback containing computation and cache
publication. Release is attempted in its existing `finally` block after that
callback settles. XFetch's delta and computation metrics measure the compute
callback alone, excluding Redis publication time.

A shared `StampedeLock` failure propagates to its existing followers rather than
silently starting one retry per follower. Both flight maps remove entries only
when the completing promise still owns the key. A subsequent explicit call can
retry. The existing `StampedeLock.clear()` detaches the local map; it does not
cancel already running callbacks or change distributed-lock ownership.

Distributed contention still waits 300 milliseconds and rechecks L1/L2. If no
fresh value exists, the existing emergency computation policy remains, with one
computation/publication per process-local flight. Null and undefined results are
valid completed outcomes, even though `set` intentionally does not cache them;
joined callers do not recompute them implicitly.

## Persistence and consistency limits

The Redis lock still has its existing fixed TTL and is not renewed. Holding the
callback through publication cannot guarantee exclusivity after that TTL expires
or across processes during an outage. The emergency computation policy can still
run independently in different instances. This change does not alter the shared
Redis lock primitive, token ownership, cache TTLs, XFetch policy, direct set/delete
invalidation races, or admission limits for distinct keys.

`set` retains existing degraded-mode behavior: L1 updates before L2, and a Redis
publication error is logged and returns false while the computed L1 value remains
available. Unexpected thrown publication errors reject the shared flight, with
lock release and flight cleanup still attempted.

## Tests

```sh
npm ci --prefix tools/cache-flight-tests --ignore-scripts --no-audit --no-fund
tools/cache-flight-tests/run.sh
```

The locked harness copies the actual cache modules and test file into a temporary
ESM workspace. Only Redis configuration, logging, and the shared distributed-lock
boundary are controlled test doubles. No live Redis or provider traffic occurs.
Tests verify failed caller fan-out, contention fallback, blocked publication,
release ordering, foreground/background joining, false/null/undefined outcomes,
independent keys, retry cleanup, and XFetch timing.
