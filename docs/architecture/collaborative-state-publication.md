# Collaborative recommendation state publication

The shared recommender runs in executor threads. A reentrant lifecycle lock
serializes explicit loads, training and successful cold initialization. A short
state lock protects publication of the aligned serving fields and their capture
by public recommendations.

Training builds arrays, IDs and popularity rankings locally, persists the
complete payload, then publishes it. Load resolves every required key before
changing serving fields. Preparation, missing-key or persistence errors retain
the previous serving state. A failed cold attempt releases the lifecycle lock,
allowing a later call to retry. The existing missing/corrupt-artifact synthetic
training fallback is preserved, not presented as a real-data training pipeline.

A recommendation captures its user-row index together with entity IDs, score
array and popularity order under the state lock. It then scores and excludes
booked entities outside both locks. Thus warm requests continue on a consistent
previous state while training or refresh is in progress, and an already captured
request can finish after a newer state is published. Scoring copies its score
row before masking bookings; it does not mutate the published arrays.

The serving references are replaced, not mutated by load/train. Direct external
mutation of public arrays/attributes is not synchronized by this protocol.
There is no cross-process invalidation, bounded native training cancellation,
artifact-reader lease change, payload-shape validation redesign, ranking-policy
change or globally coordinated training admission here.

## Verification

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_collaborative_state_lifecycle.py backend/ml/tests/test_collaborative_filter_topn_validation.py backend/ml/tests/test_collaborative_filter_missing_ratings.py -q
```

The 26-test group covers partial initial loading, concurrent cold artifact loads
and fallback training, refresh during scoring, warm serving before persistence,
failed training/refresh, retry, known/cold-user booking exclusions, existing
count validation and missing-rating SVD behavior. Eleven new regressions fail
against unchanged main. Threaded tests use controlled storage/data boundaries
with the actual class, ranking methods and NumPy SVD; no provider or production
storage is called.
