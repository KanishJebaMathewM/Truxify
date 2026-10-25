# Native federated model admission

The live TensorFlow server previously accepted an encrypted empty layer list into quorum. Once three clients responded it replaced the published six-layer baseline with an empty list before Keras rejected the update. Clipping also rewrote accepted buffers before all candidates were known to be valid.

Updates now require the entire real Keras schema, exact layer shapes, real numeric arrays and values representable as finite native layer weights. Admission owns each buffer before recording an accepted update. Round tags must be actual integers. Encrypted envelopes are bounded at 4 MiB before decryption.

Candidate preparation copies all accepted buffers, validates finite nonnegative clipping/noise settings, computes clipping and Gaussian noise privately, preserves coordinate-wise median aggregation, and revalidates the complete native-dtype candidate. Keras receives the candidate before publishing global weights or completion state. A process-local reentrant lock serializes round start, admission, aggregation and model snapshots.

## Reproduction and verification

Use Python 3.11 with the pinned packages in `.github/workflows/federated-model-admission.yml`, plus a native `redis-server` executable. Run:

```sh
TF_NUM_INTRAOP_THREADS=1 TF_NUM_INTEROP_THREADS=1 PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_federated_model_admission.py backend/ml/tests/test_federated.py -q
```

The new suite creates a private Redis Unix socket, actual TensorFlow model, real Fernet envelopes and real H5 checkpoint files. Only background pubsub consumption is excluded; direct envelope ingestion, Redis round state and aggregation remain native. Cases include malformed layers and native float32 overflow, invalid/stale round tags, valid retries, once-only concurrent admission, candidate preparation failure, buffer ownership, independent expected valid model output, and concurrent complete publication. Existing federated tests are also run, importing real TensorFlow first.

New sources use full Ruff analysis. The legacy server has existing import, annotation, broad exception, date/time and simplification findings; the focused workflow explicitly ignores those existing rule families, rather than claiming full legacy-file lint passes.

## Boundaries

This is process-local admission and candidate publication, not distributed round ownership or restart recovery. Existing Redis persistence, checkpoint error handling, pubsub lifecycle and model loading remain outside scope. A preparation failure retains admitted buffers for diagnosis or an explicit retry; it does not automatically repair invalid DP configuration. Gaussian noise is still the existing mechanism: this change does not certify differential privacy. No production model, real sensor, vehicle control or paid provider is involved.
