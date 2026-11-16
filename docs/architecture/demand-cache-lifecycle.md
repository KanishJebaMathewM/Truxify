# Demand model cache lifecycle

Demand inference runs on executor threads. The module uses three separate locks:

- The existing reentrant training lock serializes training and rollback.
- A short state lock guards the cached tuple and invalidation generation.
- A load lock coalesces successful cold loads without holding the state lock
  during artifact I/O.

Reset increments the generation and clears the tuple under the state lock. A
cold loader snapshots that generation before I/O and publishes only if it still
owns the current generation. Otherwise it reloads. Waiting cold callers recheck
the cache after acquiring the load lock. Exceptions release that lock so a later
caller can retry; followers do not all inherit the same failed attempt.

Warm inference captures a local tuple under the short state lock, then releases
it before scaling/predicting. It never acquires the training lock, so existing
warm predictions can continue while training runs. An already captured warm
tuple may finish after reset; it cannot repopulate the cache. Predictions that
start after a completed reset load the current artifact.

Rollback now holds the same training lock around restoration, invalidation and
result metadata. Failed/no-op restoration preserves the cache. This does not
provide cross-process invalidation, artifact/metadata reader leases, cancellation
of native model calls, or a deadline on cold storage reads. Continuous resets
can force repeated cold loads. Existing validation and model error handling are
retained.

## Verification

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_demand_cache_lifecycle.py backend/ml/tests/test_demand_forecast.py -q
```

Tests import the actual demand module, use controlled model/storage doubles for
threaded interleavings, and retain the existing real scikit-learn training,
promotion and rollback tests. No provider, production storage or deployment is
used. The focused workflow pins the model dependency declared by ML requirements.
