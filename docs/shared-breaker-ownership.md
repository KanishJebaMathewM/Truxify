# Shared circuit breaker operation ownership

`lib/circuitBreaker.js` is used by order lifecycle routing and ML calls. Each
admitted operation captures a circuit generation. Opening the circuit or an
explicit reset starts a new generation. Older completions retain their caller
result/error/fallback but do not reset health counters or change newer state.
Scheduled recovery is also generation checked.

A HALF_OPEN admission captures one native recovery owner. Provider fulfillment
or rejection releases only that captured owner. Caller timeout still aborts the
existing signal and follows `countTimeoutAsFailure`, but does not itself release
native ownership. Recovery after backoff rejects/falls back while that provider
remains unfinished. With timeout-as-failure disabled, late native settlement
releases ownership without changing health; a subsequent probe can recover.

Explicit `reset()`/`destroy()` remain reusable health overrides, as before, and
fence old completions. They retain an unfinished native recovery owner: they
cannot prove cancellation. Normal CLOSED traffic retains its existing admission
semantics; this does not cap all outstanding calls or drain every old CLOSED
operation before recovery. Only recovery probes are single-owner bounded.

A provider that never settles deliberately holds that recovery slot forever.
Operators must diagnose the provider; silently admitting more probes would
accumulate unfinished work. AbortSignal remains cooperative. No cancellation,
rollback, side-effect reversal, cross-process coordination or exactly-once
behavior is promised. The metrics describe the current circuit generation;
stale completions do not repopulate counters after reset.

From the repository root:

```sh
npm ci --prefix tools/shared-breaker-tests --ignore-scripts
 tools/shared-breaker-tests/run.sh
```

The isolated runner copies the actual shared breaker and existing unit file,
with only logging replaced by a local no-op boundary. New tests use native
promises, a real-timer non-cooperative provider case, and deterministic clock
interleavings; no actual provider/database/financial action occurs. Production
package versions and the separate OSRM-service breaker are unchanged.
