# Native ETA observation ownership

`TrafficPipeline.predict_eta` owns a complete real finite five-feature row, a
private retained window and a separate 60-step model input. Accepted input shapes
are `(5,)` and `(1, 5)`; extra rows were formerly silently discarded and are now
rejected. Numeric strings remain convertible. Complex, malformed and nonfinite
rows return the existing failure value `None`.

A lazily initialized pipeline-local reentrant lock is shared with the realtime
wrapper. It covers preparation, native inference, result validation and the short
window/LRU/metric commit for every direct and realtime caller. A native failure or
nonfinite/non-scalar output leaves the prior state intact. The most recent route
metrics describe the latest successful committed prediction; reading them uses
that owner and returns an independent dictionary. They are global diagnostics,
not a receipt belonging to an arbitrary concurrent HTTP caller.

Successful observations preserve route/destination identity, 60-step cold padding,
1000-window capacity and LRU eviction. Retained arrays are privately owned and
model inputs are separately copied. Finite signed predictions keep their existing
consumer semantics; this protocol does not establish physical prediction quality.
Normalization and training generation publication are unchanged. The existing
provider/ingestion patch chain is outside this repair.

Ownership is synchronous and per instance, not fair scheduling or cross-process
ordering. Waiting for the same pipeline can occupy inference workers; the existing
bounded executor/backpressure policy remains. Cancellation of an HTTP waiter does
not stop admitted native work. Copying an input does not provide an atomic snapshot
while an external writer concurrently modifies it without synchronization. Native
process failure or memory allocation failure is not a durable transactional commit.

## Verification

The focused gate uses learned native TensorFlow/Keras inference, independent mean
and retained-row witnesses, malformed/complex/nonfinite inputs, actual nonfinite
and multi-output native models, a controlled failure after native inference,
shared direct/realtime ownership, stable LRU/cold/60-step geometry and existing
route-history/worker consumers. No production database/provider/vehicle is used.
See `.github/workflows/eta-observations.yml` for the pinned Linux command.

The unchanged upstream formula expectation in
`test_update_eta_uses_bounded_inference_executor` fails (20.02002 vs 1000),
already covered by assigned #17566/open #17567. It is explicitly deselected from
this focused gate; provider/formula changes are not included here. All other
selected existing worker/window/identity consumers and the actual mounted native
HTTP prediction run. Broad suite green status is not claimed. Existing protobuf
and Keras/NumPy deprecation warnings are retained.
