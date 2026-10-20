# Model reader lifetimes

Model publication retains active and previous immutable generations. A slow reader
can outlive both pointers after two further publications, so pointer atomicity alone
does not protect the file it is about to open.

## Reservation and reclamation

The per-model writer lock serializes candidate admission with publication, rollback,
and deletion. An admitted immutable reader increments its generation's reference
count, then releases the writer lock before verification, deserialization, and
metadata reading. Writers can publish while that reader runs. Reclamation retains
active, previous, and every generation with a live reservation. The reader's
`finally` releases its reservation and reclaims obsolete generations, including
when verification fails or deserialization raises.

There are at most two pointer-retained generations plus the distinct generations
currently reserved by live readers. A stalled reader intentionally retains its one
generation until it exits; this is not a wall-clock expiry or an absolute disk cap.
The counters are process-local. Independent OS processes sharing one artifact
store require additional coordination and are outside this guarantee.

`delete_model` removes pointers and mirrors and stops new admissions. Already
admitted readers may finish their immutable snapshot; the last reservation reclaims
its directory. A subsequent publication can immediately create a new active model
without invalidating those older readers. Legacy flat mirrors are mutable, so their
entire read holds the writer lock instead of using a generation reservation.

## Matched metadata

`load_model_snapshot(name)` returns a `ModelSnapshot` with `model`, `metadata`, and
`generation`. Its model and metadata belong to the same immutable generation.
Missing, malformed, or mismatched metadata yields `None` metadata, never another
generation's metadata. Legacy snapshots have no immutable generation identifier.
`load_model` preserves its previous return shape. Separate `load_model` and
`get_model_meta` calls remain independent reads; use the snapshot API for a pair.
Existing artifact verification is preserved before deserialization.

## Verification

The focused workflow runs native threads against real temporary model files,
including two publications during a paused reader, twenty successive publications,
multiple readers, deletion/republication, rollback, exception cleanup, metadata-only
reads, legacy serialization, selection/admission races, and verification rejection.
It needs no TensorFlow, external provider, deployed service, or production model.

The unchanged main persistence suite has three failing `TestModelIntegrity`
assertions expecting old flat-file SHA256/rollback behavior. The same three fail on
this branch; they are neither removed nor rewritten here. The focused workflow
is a reader-lifetime regression gate, not a claim that the whole ML suite passes.

## Mounted prediction consumers

Price prediction now checks `is_real_model` on the metadata of its admitted
artifact. Driver-profit loading obtains feature-domain metadata from the same
snapshot as its regressor. Concurrent publication may change what a subsequent
request admits, but cannot substitute another generation's real-data flag or
feature bounds into an already loaded artifact. Seven consumer checks use real
scikit-learn artifacts, including two controlled native publisher interleavings
that failed with the old independent accessor calls. Missing/ineligible metadata
retains the existing unavailable/retrain behavior. Weather and business feature
validation are unchanged.
