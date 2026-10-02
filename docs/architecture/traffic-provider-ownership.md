# Traffic provider request ownership

The Node traffic service is called by order creation, lifecycle pricing, ETA calculation and truck quotes. Exact concurrent provider URLs now share a native owner across point, enterprise and route lookups. The URL is captured before deferring the fetch, so provider/key changes and unequal coordinates remain separate. TomTom point and route calls can share the same raw provider data while retaining their distinct output calculations; Google requests with different destinations do not coalesce.

## Admission and expiry

One process admits eight distinct provider owners without a waiting queue. A shared five-second deadline requests abort and rejects all attached callers, which keep their existing fallback: point pricing returns1.0 and route lookups return the original rush-hour heuristic. Further calls attached to an expired owner get the same rejected promise until the owner settles. Admission stays occupied through fetch, JSON parsing, or cancellation of an unused HTTP-error body. Identity-checked cleanup clears the timer and removes only that owner after native settlement. Late body results are checked against the abort signal before returning data; late rejections are observed.

The cap is process-local, not a distributed rate limiter. JavaScript timers require a responsive event loop. Abort is cooperative: a stuck native operation retains its slot and can eventually saturate all eight slots, causing fallback rather than unbounded replacement requests. This is not an absolute native completion guarantee.

## Compatibility and limits

Provider formulas, TomTom precedence, exact request coordinates, zero-coordinate guards, Redis keys/TTL and skipCache behavior are unchanged. There is no new persistent provider cache. Redis reads/writes remain outside this provider deadline; this change does not bound a stalled Redis command. The enterprise wrapper retains its existing policy of caching the delegated1.0 fallback. Route failures do not cache a late successful result. Coordinate validation remains the separate active16749/16757 work.

## Verification

Install the locked focused harness with `npm ci --ignore-scripts --prefix tools/traffic-ownership-tests` and run `bash tools/traffic-ownership-tests/run.sh`. It copies the actual production service/helper into a temporary tree; only database configuration and logging are replaced at the import boundary. Provider calls are controlled doubles, not live requests. Tests cover duplicate calls through body completion, point/route overlap, shared native capacity, abort-ignoring headers/bodies, late failure/retry, HTTP error-body disposal, provider configuration capture, distinct Google destinations, arithmetic and cache/fallback preservation. The full API suite and live providers are not verified by this focused gate.
