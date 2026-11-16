# Driver-profit predictor serving lifecycle

The `/predict/driver-profit` endpoint calls the singleton predictor through the
inference executor. Requests can run on different native threads, so assigning a
training estimator before fitting it exposes unfinished state to other callers.

## Ownership and publication

Each predictor has a reentrant lifecycle lock and a short state lock.

- `train` and `load` serialize through lifecycle ownership. Reentrancy permits
  the existing load-to-training fallback without deadlock.
- Training fits a local estimator, computes its metrics and prepares its domain
  metadata. Persistence completes before the model/domain pair is published.
- Loading converts and validates every feature range before publication. Bounds
  must be finite and ordered. Missing artifacts or domain metadata retain the
  existing fallback to synthetic training.
- Failed fit, metrics, persistence or metadata preparation leaves the previous
  in-memory serving pair intact. Cold failure leaves the predictor uninitialized
  so a later caller can retry.
- Publication replaces model and ranges together under the state lock.

Warm inference captures that pair under the state lock and releases it before
validation and estimator work. Point and staged confidence predictions both use
the captured estimator; domain validation uses its captured ranges. Internal
lifecycle operations never mutate a published estimator or range mapping.

Cold inference acquires lifecycle ownership, rechecks state and loads only if
still needed. Successful concurrent initialization is coalesced. Lock order is
lifecycle then state; no code waits for lifecycle ownership while holding state.
Warm requests can finish while candidate fitting, persistence or loading waits.

## Compatibility and limits

Public prediction shape, synthetic training data, feature-domain rules and
confidence calculation are retained. `model` and `feature_ranges` attributes
remain available for existing fixtures, but concurrent external mutation of
these attributes or the estimator is outside this protocol.

Coordination is process-local. Separate artifact and metadata reads remain
independent; this change does not guarantee one on-disk generation across those
reads or provide cross-process synchronization. Artifact reader reservations
and matched model/metadata loading are separate storage work. A native operation
that never returns holds lifecycle ownership until it settles; no cancellation
or absolute training deadline is introduced. Synthetic predictions remain
placeholders rather than validated freight-economics estimates.

## Verification

`PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_driver_profit_lifecycle.py backend/ml/tests/test_driver_profit_predictor.py -q`

The focused gate uses service-compatible declared dependency versions. Tests
exercise controlled native-thread interleavings, failed fit/save/load, coherent
estimator/domain capture, existing domain/output behavior and a real small
GradientBoostingRegressor fit with isolated persistence. No production model,
provider or deployment is used.
