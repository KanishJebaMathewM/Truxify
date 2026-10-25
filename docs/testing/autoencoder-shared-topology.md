# Shared LSTM autoencoder topology

`LSTMAutoencoder.encoder` now returns the actual `(B, latent_dim)` bottleneck.
`decoder` accepts that vector and returns `(B, sequence_length, input_dim)`.
The decoder's recurrent, dropout and output layer objects are the same instances
used by the flat end-to-end model. Native optimizer updates and weight reloads
therefore affect both views immediately. Deterministic inference satisfies
`decoder(encoder(x, training=False), training=False) == model(x, training=False)`.
Training-mode dropout draws are stochastic; separate calls need not match.

This follows [Keras functional weight sharing](https://keras.io/guides/functional_api/).
The original flat weighted-layer order and shapes are retained. Native tests
save a trained independent pre-fix full-model architecture as HDF5 and reload
its weights into the corrected model, then verify composition. Existing
`save`/`load` HDF5 plus JSON metadata methods also round-trip; calibration is
restored after successful weights loading. Previously exported standalone
encoder/decoder views had wrong shapes/untrained weights and are not treated as
valid trained artifacts. Public encoder output deliberately changes shape.

All dimensions must be positive integers (excluding booleans). Build prepares
the model, encoder and decoder locally before publishing the complete view set.
A successful fresh build clears old threshold and observation buffers; failed
configuration admission preserves existing views/calibration. This is a
single-owner lifecycle contract, not concurrent model replacement. Existing
multi-file save/load is not made crash-atomic, and optimizer-resume parity is
not claimed by the existing weight-only load method.

## Native checks

```
TF_NUM_INTRAOP_THREADS=1 TF_NUM_INTEROP_THREADS=1 PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_autoencoder_shared_topology.py
python -m ruff check backend/ml/anomaly/models.py backend/ml/tests/test_autoencoder_shared_topology.py
```

Local TensorFlow2.16.2 / Keras3.15.1 runs 26 tests; the focused Linux gate uses
repository-declared TensorFlow2.16.1 / Keras3.15.1. Tests use actual native
TensorFlow execution, variable identities, optimizer steps, view assignments,
legacy HDF5 weights and metadata reload; no neural model is mocked. Protobuf
Python3.12 deprecation warnings and Keras's existing HDF5 legacy-format log are
visible. The changed source has full-file Ruff checks.

Actual AnomalyDetector consumers continue using the same end-to-end model.
This PR does not change rolling-window logic, threshold estimation, score
normalization, detector concurrency, Redis integration or alert calibration,
and does not claim a full service test or deployed detection quality.
