# Native coordinate median and bounded L2 projection

robust_aggregate validates finite real matching client/prior layers and a finite nonnegative scalar radius. Even coordinate midpoint uses ordinary safe sums where possible (preserving subnormal rounding), and bounded same-sign differences where large sums could overflow. Odd medians remain order statistics.

Positive-radius projection scales the actual difference before its L2 norm. If raw subtraction overflows, endpoint scaling forms bounded direction coordinates. This distinction preserves small changed coordinates next to huge unchanged coordinates. Radius0 retains existing clipping-disabled behavior. Inputs are copied, never mutated; finite float64 aggregates are returned.

Run:

```sh
PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_federated_stable_projection.py
python -m ruff check backend/ml/federated/fl_server.py backend/ml/tests/test_federated_stable_projection.py --select E9,F63,F7,F82
```

33local native NumPy tests pass; unchangedmain fails24/passes9. Independent scalar Decimal references (1200-digit context preserves exact binary64 subnormal midpoint ties and extreme subtraction) verify finite even medians, unit-ball projection direction/radius, positive/negative extremes, tiny updates beside huge unchanged coordinates, ordinary order/shape compatibility and invalid-input immutability. Native finite1e308 deltas correctly project to1/sqrt2 instead of disappearing; identical1e308 even medians stay finite.

Actual consumer FederatedServer._aggregate_weights calls this helper for each layer. This PR verifies the production NumPy helper only, not TensorFlow/Redis orchestration or the separate preceding per-client DP/noise stages, whose squared norms may need independent work. No model fit or new aggregation/clipping policy. Focused Linux NumPy gate only; no mocked TensorFlow evidence.
