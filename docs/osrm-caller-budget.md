# Live OSRM caller budget

`getRouteEstimate` and `getRouteGeometry` in `services/osrm.js` now share a monotonic caller deadline covering cache reads/writes, all HTTP headers/body waits, and retry backoff. An estimate's non-2xx response body is handled while its attempt timer still owns the request. Total or attempt expiry aborts the owned native fetch signal, including body consumption. Budget checks before dispatch and after completion suppress late retries/cache writes/result revival; an advisory cache failure can still proceed to provider routing while time remains.

## Configuration

| Setting | Default | Normalization / upper bound |
| --- | --- | --- |
| OSRM_TOTAL_TIMEOUT_MS | 5000 ms | Positive finite value, integer floor, minimum1, maximum30000 ms |
| OSRM_CACHE_TIMEOUT_MS | 100 ms per read/write | Same normalization, maximum1000 ms, also limited by caller remaining time |
| OSRM_TIMEOUT_MS | 1500 ms per HTTP attempt | Same normalization, maximum30000 ms, also owned by the caller's total deadline |

Invalid/nonpositive values use the default. Retry count and base-delay configuration retain their existing semantics; the existing10000ms backoff clamp is retained. A retry whose backoff cannot fit the remaining budget is skipped and returns the existing null fallback. The new5000ms total budget can end a multi-attempt request earlier than the old independently restarted timers.

The existing opossum breaker configuration, geometry/estimate result shapes, cache keys/TTLs, coordinate validation and haversine fallback helper are unchanged. A normal cache hit avoids HTTP. Cache waits remain advisory: a short write timeout may return a route already computed, while a total deadline suppresses results that arrive too late. Unexpected lifecycle/configuration failures return null with a structured warning rather than escaping the routing helper. No live OSRM/provider/deployment action is performed.

## Resource and timing limits

Redis commands have no portable per-command cancellation in this client. A timed-out command may remain queued or finish later. This change bounds caller waiting and prevents subsequent routing/cache-write continuations; it cannot undo a cache write already dispatched, bound Redis's own queue, or terminate a transport that ignores its abort signal. Native fetch is aborted; tests confirm loopback unfinished bodies close. This is not a global concurrent-request admission limit. Timer callbacks run when the JavaScript event loop can schedule them; blocking synchronous work/JSON parsing can delay wall-clock completion. Monotonic checks still reject late completion even if the timer has not run. No hard real-time or provider-latency guarantee is claimed.

The response drain introduced by #4578 is retained; non-2xx bodies finish or owned abort closes the exchange. The breaker still records HTTP action outcome using its existing semantics; this PR does not redesign breaker recovery/health scoring. Other logging/error-provenance and coordinate-validation PRs have separate scope.

## Verification

```sh
cd tools/osrm-budget-tests
npm ci --no-fund
cd ../..
bash tools/osrm-budget-tests/run.sh
```

The locked harness executes actual service/budget code with real opossum10. Logger/database imports are controlled test boundaries, and actual performanceMetrics is retained. Twenty-one lifecycle/normalization/cleanup cases plus37 existing OSRM cases pass locally, including four real loopback HTTP tests for unfinished404/JSON bodies across estimate and geometry. Real tests verify response closure; deterministic tests verify stalled cache/read/write, late body/cache completion, retry admission and timer cleanup. This focused gate does not claim whole-monorepo CI or deployed-provider validation. Node22 is used in GitHub CI.
