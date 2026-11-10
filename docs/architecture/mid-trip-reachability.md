# Mid-trip insertion on partial road tables

OSRM null cells mean unreachable directed travel, represented by positive infinity in the admitted road matrices. They are not transport failure and must not trigger invented geometric roads. A recommendation requires a finite baseline reference and a complete finite candidate route, as well as the existing append-at-end pickup deadline policy.

Partial road tables now prefetch the directed edges needed by every insertion into linear workspace, then stream the same exhaustive pickup-before-dropoff order with quadratic arithmetic. Each candidate uses complete added edges and the finite original edges removed from its gaps. Consecutive pickup/dropoff reconstructs its whole gap directly; it never subtracts an unreachable pickup-only closing edge from another infinity. Infeasible options remain represented by infinite detour costs internally and are excluded before deadline/ranking/publication. Unreachable baselines produce no options because their detour reference cannot be certified.

Finite-road behavior, lexicographic objective, list-returning compatibility wrapper and append-pickup feasibility remain unchanged. The positive-infinity compatibility behavior from #16961 is intentionally corrected; the old cubic materialized fallback remains only for legacy invalid/nonfinite arithmetic outside admitted partial-road tables and large finite values. The recommender filters any nonfinite option before publication. No shortest-road consistency, provider accuracy, optimal trip planning or vehicle certification is inferred from arbitrary table cells.

At20/40/80 waypoints the actual disconnected-dropoff iterator previously read10771/74331/551851 matrix edges; it now reads315/615/1215. These are deterministic access counts, not elapsed-time or hardware claims. No provider adapter change or pruning of feasible positions is introduced. The list wrapper still allocates its requested quadratic output; the production consumer streams.

## Verification

Independent full-path reconstruction covers50 seeded partial directed tables, explicit adjacent-gap infinity cancellation, distance/duration baseline reachability and deterministic linear reads. Actual Requests/loopback OSRM tests verify disconnected dropoffs are rejected and reachable directed alternatives produce finite JSON. Existing finite oracle, streaming memory, deadline, payment, road-unit and core mid-trip controls remain in the focused Linux gate. The former positive-infinity legacy baseline fixture is superseded by explicit unreachable-baseline assertions in both dimensions; negative infinity/NaN/large finite legacy controls remain.

```sh
PYTHONPATH=backend/ml OSRM_BASE_URL=http://127.0.0.1:1 python -m pytest \
 backend/ml/tests/test_mid_trip_reachability.py \
 backend/ml/tests/test_mid_trip_insertion_complexity.py \
 backend/ml/tests/test_mid_trip_deadline_insertion.py \
 backend/ml/tests/test_mid_trip_payment_validation.py \
 backend/ml/tests/test_mid_trip_road_eta.py backend/ml/tests/test_mid_trip_model.py -q
```

The broad mounted API test requires the full ML application dependency stack and is not part of this focused gate.
