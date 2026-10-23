# Bounded return-load road durations

The production `/match/deadhead` endpoint calls `find_return_loads` in an
inference worker. Its candidate list has no count restriction. Previously the
routing helper submitted one table containing all pickups plus the driver,
regardless of the backend's location limit. The URL also contained literal
backslash-dollar prefixes that prevented requests from reaching OSRM.

## Indexed batches and fallback

Each table contains one driver source plus up to99candidate pickups. The
100coordinate cap matches the [OSRM default table limit](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/tools.md).
Local destination indices1..99 map back into a slice of the original candidate
array; sorting/profit calculation remains in the existing matcher.

A lookup dispatches at most4requests, with a3second monotonic budget for starting
new requests. Each request uses a timeout no larger than the original1.5seconds
or its remaining dispatch budget. A process-local semaphore admits at most4
native lookups. It remains held through response parsing, closing responses and
assembling fallback results. Saturation returns the existing whole-list fallback
without making a provider request.

Successful batches retain their road durations. Failed, malformed or unattempted
batches use the existing Haversine/40kmh approximation for each candidate;
explicit `null` durations in successful responses remain unreachable. If every
batch is unavailable, the helper returns `None`, preserving the existing matcher
fallback path. At most396candidates obtain road durations in one lookup; remaining
candidates still participate under the existing approximation. Routing-disabled
and empty-list behavior is unchanged. No scoring, capacity, timezone or coordinate
validation policy is changed; the independent coordinate-validation issue16110
remains owned by its contributor.

## Limits

The scheduling budget is not an absolute operation deadline. Requests' socket
connect/read timeouts do not cancel all native work or bound response parsing and
fallback computation; a slow operation retains its permit until actual settlement.
No cross-process admission, live provider benchmark or network-route accuracy
guarantee is introduced. Approximate fallback already exists and can admit loads
that an unavailable road route would reject. Deployment and provider configuration
are unchanged. The full scoring pass still considers all candidates.

## Verification

Install the exact focused dependencies from
`.github/workflows/ml-deadhead-routing-batches.yml`, then run from repository root:

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_deadhead_routing_batches.py backend/ml/tests/test_deadhead_eliminator.py -q
```

31tests cover batch boundaries/alignment/URL/query, partial provider/JSON/shape/code
failures, request count and monotonic budgets, admission retained during parsing,
exception release, offline fallback and existing matcher behavior. The loopback
HTTP integration runs the actual matcher against bounded tables and proves road
ETA and unreachable responses still filter candidates. Six fixture lines add
`close()` to the existing fake responses for the new resource cleanup. Eleven
new regression cases fail unchangedmain06da794fd. No public provider, live database,
credentials or deployed OSRM map is used. The full ML suite is outside this gate.
