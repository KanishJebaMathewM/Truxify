# Delivery-stop completeness at the OSRM boundary

`orderLifecycleService.createOrder` persists the stop list returned by `optimizeWaypoints`. Accepting a partially reconstructed provider result could therefore drop an actual delivery. The response must describe a complete permutation before the backend accepts its optimization.

The OSRM Trip service returns waypoint objects in **input order**, with `waypoint_index` indicating each point's optimized position. For the existing `roundtrip=false&source=first&destination=last` request, the input start/end must remain the first/last trip positions. The service now requires exactly N+2 point objects, unique integer indices in 0..N+1, and those fixed endpoints. That combination proves a bijection: every middle stop appears exactly once. Reconstruction remains O(N) time and O(N) auxiliary memory and retains the original stop object references, including separate deliveries at the same coordinates. The correct existing mapping direction is preserved.

If `trips` is present it must be an array with exactly one trip. If any point includes a defined `trips_index`, every point must have numeric trip index zero. Legacy provider fixtures which omit all trip membership fields remain accepted; this compatibility does not relax cardinality, index or endpoint validation. Route geometry/leg contents are not revalidated here.

Invalid responses return the entire effective input list in its original order, including any predictive bypass. They emit one warning rather than filtering missing slots. The returned list is not guaranteed optimal when fallback occurs, but cannot silently lose stops through malformed permutation reconstruction. This does not detect a semantically wrong yet structurally valid optimizer permutation. Input coordinate handling, work-zone prediction, ten-second Axios timeout, pricing and LTL logic are unchanged.

## Verification

From the repository root, with Node.js >=20.19:

```bash
npm ci --prefix tools/waypoint-permutation-tests --ignore-scripts
bash tools/waypoint-permutation-tests/run.sh --testNamePattern '^(?!.*should throw TypeError when non-finite coordinates)'
```

The focused command runs 31 new actual-service cases and 23 existing routing cases, including an independent oracle checking all 152 permutations for two through five middle stops. Axios and work-zone prediction are controlled import boundaries; existing tests also execute the actual work-zone module where appropriate. No routing provider or database is contacted. Malformed cardinality, repeated/fractional/out-of-range indices, endpoints, trip metadata, bypass retention, duplicate coordinates and original object identity are covered.

The single excluded existing `getHaversineDistance` test expects a TypeError for nonfinite coordinates while current production intentionally returns null. Running the harness without the name filter exposes that same unrelated failure on both baseline and this branch; it was not modified or hidden in the test source. The default full harness result is 54 passed / 1 pre-existing failed. CI names that exclusion explicitly. The new permutation suite passes all 31 cases; the actual baseline fails 23.

Set `ROUTING_SERVICE_SOURCE` to an absolute baseline service path to repeat the before/after comparison without overwriting the worktree.

Provider contract: https://project-osrm.org/docs/v5.24.0/api/#trip-service
