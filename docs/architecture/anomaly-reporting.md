# Native anomaly reporting and Redis delivery

A valid observation is normalized/scored against one calibrated model/scaler generation under existing generation ownership. The detector prepares independent return/history records, strict JSON cache/event payloads and delivery correlation before committing its temporal frame. Returned results, history snapshots and statistics cannot mutate committed nested records through aliases.

Every committed observation receives a service-instance sequence and entity key beside the existing model generation. The native response adds `alert_delivery`:

- `not_required`: no alert needed Redis publication.
- `published`: the alert's Redis SETEX/PUBLISH calls were acknowledged.
- `unavailable`: external delivery failed after valid native observation commit.

An unavailable outcome can include a partially applied cache write or an accepted write whose reply was lost. It does not undo/reclassify native scoring, and it does not claim consumers received the event. Native admission/scoring/report-preparation failures continue to return an error before commit.

Redis I/O runs outside the calibrated generation/window lock. History, threshold access and non-alert native serving can progress while Redis delivery stalls. Alert requests can still wait on delivery, governed by their configured Redis timeouts. No new native interrupt or delivery deadline is provided.

Prepared alert records enter a synchronous FIFO handoff under generation ownership. Native callers drain that handoff in commit order under a separate native delivery owner; each prepared record has a private outcome future. A caller may deliver an earlier record whose original worker has not yet reached publication. Draining stops when that caller's own outcome is known, so later arriving records do not extend its batch indefinitely. Cancellation of the HTTP waiter does not cancel native delivery ownership. This preserves event and latest-cache ordering, including delayed original workers and lost replies.

The handoff is process/service-instance local, temporary and synchronous. It starts no background tasks and provides no durable outbox, retry, cross-process ordering or exactly-once delivery. Sequence values restart with a new instance and cannot establish global ordering across replicas. Redis cache and bus commands are not one transaction. Training/scaling/window generation policy and native reconstruction/calibration quality are unchanged; no physical alert accuracy, vehicle or provider certification is claimed. Direct mutation of detector internals remains unsupported.

## Native verification

Actual learned TensorFlow2.16.2/Keras3.15.1, genuine StandardScaler/95th-percentile calibration and private Redis7.2.5 cover return/history/statistic ownership, paused WRITE reader/non-alert progress, actual connection failure, Redis ACL publication denial, delayed native commits, lost reply after an actual cache write, report-preparation rejection and mounted FastAPI GPS cancellation. The old strict-cache test now compares the native observation fields and explicitly checks the separate delivery outcome; no numerical/window assertions were removed.

```sh
PYTHONPATH=backend/ml TF_NUM_INTRAOP_THREADS=1 TF_NUM_INTEROP_THREADS=1 \
 OMP_NUM_THREADS=1 python -m pytest \
 backend/ml/tests/test_anomaly_reporting.py \
 backend/ml/tests/test_anomaly_generation_contract.py \
 backend/ml/tests/test_autoencoder_shared_topology.py -q
```

Native fixture deprecation warnings from protobuf/Starlette/Pydantic are retained and reported. All Redis instances use private sockets; no production sensors, providers or controls are exercised.
