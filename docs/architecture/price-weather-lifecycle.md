# Price-weather lookup ownership

`predict_price` runs in an inference worker and synchronously obtains weather
multipliers for its normalized origin/destination cities. A shared HTTP client
and bounded city cache already existed. Concurrent cache misses previously
started separate requests, and a request admitted before cache reset could
repopulate the cleared cache afterwards.

## Admission and settlement

A short reentrant cache lock covers cache lookup and reservation of a city
owner. Followers of the same generation wait on the owner's completion event
outside that lock. Providers run outside the lock, allowing other cities and
cache hits to progress. An owner publishes its result, releases its reservation,
and signals followers when the provider actually settles, including exceptions.
A caller's wait expiry never releases that provider's reservation.

| Setting | Default | Limit |
| --- | --- | --- |
| `ML_WEATHER_MAX_INFLIGHT` | 4 | 1–32 synchronous owners per process; fractional values truncate, minimum 1 |
| `ML_WEATHER_COALESCE_WAIT_SECONDS` | 2 | Positive finite seconds, capped at 30 |

Invalid, nonpositive and nonfinite settings use defaults. Saturated distinct-city
admission and expired follower waits return the existing neutral multiplier 1.0
without launching another request or caching that admission fallback. Successful
clear weather still uses the success TTL, while provider failures use the shorter
failure TTL. Existing HTTP timeout and cache capacity settings are preserved.

Reset increments a generation and clears cached entries. Older providers keep
occupying capacity until settlement. New callers for their cities return neutral
rather than joining stale work or launching duplicate work. Old callers may
receive their admitted result, but that result cannot enter the new generation.
The existing async helper captures the generation before awaiting and also fences
success/failure publication after reset.

## Boundaries

Ownership and capacity are process local. The async helper retains independent
fetch behavior and is outside the synchronous owner cap; it has no current
production caller. No cross-process coalescing, provider cancellation, absolute
native-operation deadline, or shutdown draining is introduced. A stuck native
provider continues to occupy its slot. Pricing formulas, model provenance gates,
and HTTP client shutdown behavior are unchanged. No live weather requests or
credentials are required for verification.

## Verification

From repository root, install the focused pinned dependencies listed in
`.github/workflows/ml-price-weather-lifecycle.yml`, then run:

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_price_weather_lifecycle.py -q
```

The suite exercises real thread ownership with controlled provider-boundary
responses, per-city coalescing, saturation, bounded follower waiting, generation
invalidation, error cleanup/retry, success/failure TTLs, cache capacity, and actual
`predict_price` price output under concurrent calls. Async invalidation covers
both success and failure. Four public-behavior regressions fail unchanged main:
sync/async stale publication and a second concurrent same-city provider call.
The full ML suite and a live OpenWeather integration are not covered by this gate.
