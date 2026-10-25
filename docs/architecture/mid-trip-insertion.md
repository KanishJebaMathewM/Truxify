# Exhaustive mid-trip insertion evaluation

For n remaining waypoints, pickup-before-dropoff has(n+1)(n+2)/2 positions.
The finite-matrix evaluator replaces only the directed edges next to each new
stop. Prefix totals give travel to pickup. Consecutive pickup/dropoff uses a
separate gap case because the second insertion replaces an edge leaving pickup.
End insertion has no outgoing edge to remove. No symmetry, triangle inequality
or uniqueness of route indices is assumed.

The iterator reads O(n) matrix edges, does O(n²) arithmetic and keeps O(n)
auxiliary arrays. The active recommender filters pickup deadlines and keeps one
lexicographic minimum: extra distance, extra duration, pickup distance, pickup
duration. It never retains both complete candidate lists. The list compatibility
helper still returns all options in the previous enumeration order, requiring
O(n²) output storage. Nonfinite or overflow-risk relevant edges use the previous reconstruction
algorithm, including its existing nonfinite arithmetic and storage costs.

Floating-point addition order changes, so equivalence is numerical rather than
bit-for-bit. Existing nonnegative detour clamping remains. This optimization
neither reduces the already supplied OSRM matrix nor changes external calls,
coordinate policy, road units, deadline policy or recommendation fields.

At20/40/80 waypoints, unchanged main reads10,666/74,126/551,446 matrix edges.
The optimized evaluator reads210/410/810 respectively, while still producing
231/861/3,321 options. Access-count checks avoid machine-dependent timing claims.
An independent full-route oracle covers60 random asymmetric/nonmetric cases;
additional tests cover nonfinite compatibility, zero ties, empty routes and
100,000 streamed options in the actual recommender with bounded traced memory.

Run the focused suite with PYTHONPATH=backend/ml:

```sh
python -m pytest -q backend/ml/tests/test_mid_trip_insertion_complexity.py backend/ml/tests/test_mid_trip_deadline_insertion.py backend/ml/tests/test_mid_trip_road_eta.py backend/ml/tests/test_mid_trip_payment_validation.py
```

The broader test_mid_trip_model.py still has a baseline assertion that rejects a
load even though another insertion meets its deadline; no assertion is removed.
Full FastAPI application tests are outside this focused dependency environment.
