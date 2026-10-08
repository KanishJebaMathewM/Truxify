# Trust classifier/scaler serving lifecycle

`/score/trust` runs the singleton scorer on inference executor threads. Its
classifier and fitted feature scaler are one serving pair: applying a scaler
from one training run to another classifier changes the model's input meaning.

## Prepare and publish

A reentrant lifecycle lock serializes `load` and `train`, including the existing
load-to-training fallback. Training prepares the scaler and classifier locally,
fits both, computes metrics and persists the tuple before publishing either
component. Load unpacks and checks the classifier/scaler interfaces before
publication. Invalid or incomplete payloads leave the existing pair intact.
Missing artifacts retain the synthetic training fallback.

A short state lock protects complete publication and pair capture. Prediction
captures the classifier and scaler together and releases that lock before any
feature transformation or classification. It uses those captured components
throughout the request, including if a reload occurs during transformation.
Warm inference does not wait for candidate fitting, persistence or artifact
reads. Lifecycle code never mutates the published pair.

Cold predictions obtain lifecycle ownership and recheck state before loading.
Concurrent successful initialization is coalesced. The lock order is lifecycle
then state; no operation waits on lifecycle ownership while holding state.
Failures leave prior warm state available or cold state ready for a later retry.

## Compatibility and limits

Deterministic trust-score formula, risk labels, synthetic data, API authorization
and prediction output remain unchanged. Published fields remain accessible for
existing fixtures; concurrent external field changes or in-place mutations of
published estimators/scalers are outside this ownership protocol.

Coordination is process-local. It neither coordinates independent processes nor
changes artifact storage/reader reservations. Interface checks reject incomplete
payloads but do not prove semantic compatibility of arbitrary external artifacts.
A stuck native fit/read retains lifecycle ownership until settlement; this is not
native cancellation or an absolute deadline. Synthetic risk training remains a
placeholder, not a model validated against production behavioral data.

## Focused verification

`PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_trust_scorer_lifecycle.py backend/ml/tests/test_trust_scorer.py -q`

Regressions use controlled native-thread waits and mismatched scaler/classifier
tags. A real small RandomForestClassifier/StandardScaler fit verifies candidate
persistence before publication; existing formula tests are retained. Persistence
is isolated, and no live providers, production models or deployment are used.
