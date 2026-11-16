# Anomaly runtime generations

`AnomalyDetector.train_models` accepts a nonempty mapping of known data types to
complete finite real `[N, sequence_length, input_dim]` arrays. It owns every
requested dataset before fitting. Unknown types, ragged/boolean/complex/nonfinite
values, wrong temporal geometry and unsupported work fail before native training.
The mounted `/anomaly/train` body uses this three-dimensional schema.

Training supports the existing native float32 LSTM graph and ordinary Keras Adam,
1–128 sequences per type, 1–16 epochs (default **1**), input dimension at most 256,
sequence length at most 512, latent dimension at most 128, 4 million parameters,
and 512 million total `N * sequence_length * parameters * epochs` visits. This is
an admission policy, not a time or memory guarantee. Previously default 50-epoch
calls must explicitly choose an admitted count; large work must be split by the
caller. Full body parsing still happens before service admission.

Each serialized training call captures native weights and Adam configuration,
iterations and moments without mutating the old objects. It fits independent
scalers and native shared-view autoencoders outside the serving fence, checks
actual complete finite training history, registered values and positive finite
95th-percentile reconstruction calibration, and saves the existing legacy files.
Only complete success publishes all requested runtime model/scaler/calibration
pairs under one process-local lock. Missing validation history is `null`, not an
invented zero. Failed candidates preserve old runtime pairs and temporal windows.
Zero calibration is unsupported for ratio scoring and rejected at publication.

A detector observation must be exactly one finite feature vector, shaped `[F]`
or `[1,F]`; multiple rows are rejected rather than truncated. Scoring holds the
same lock through scaling, genuine per-entity temporal window construction and
native reconstruction. Warm-up still repeats the earliest genuine frame at the
front. Only finite successful native scoring commits the new frame. Publication
clears windows for replaced types so old scaled coordinates cannot enter the new
normalization. Results expose a process-local `generation` counter and Python
booleans for strict finite JSON/Redis alert serialization. An uncalibrated pair
returns the existing error envelope rather than a fabricated NORMAL verdict.
Native HTTP handlers and locked metadata reads run in FastAPI workers, including threshold
updates serialized with training; threshold values must be positive and finite.

## Limits

This fence covers calls through one detector instance. It does not coordinate
processes, external direct model/scaler/dictionary mutation, random generator
state or custom optimizer hooks. Native graph compilation and RNG effects of
failed private work are not rolled back. Consumers retaining model references
must refresh them after publication. Alert Redis failures are not distributed
transactions: the accepted runtime observation can remain in history/window.

Legacy `.h5` and metadata saves remain **non-atomic multi-file writes** and do not
persist the scaler. A failed save can alter disk files while runtime stays old;
this change does not implement crash recovery or optimizer checkpoint resume.
The existing shared encoder/decoder topology and genuine-window repairs are
preserved. Native CPU TensorFlow/scikit-learn, private Redis and mounted ASGI
tests verify the contract, not physical anomaly quality or sensor operation.
