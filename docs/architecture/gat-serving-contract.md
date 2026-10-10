# Owned graph serving and finite node populations

## Native failures

On the prior main, a valid one-node graph returns HTTP 500 because sample standard deviation is undefined with one node. Fractional local edge indices are silently converted to integers and interpreted as a different graph. Serving also leaves all shared modules in evaluation mode, losing their heterogeneous prior modes.

## Native input boundary

SpatialTemporalGAT owns dense finite node rows or [batch, nodes, time, features] sequences and dense int32/int64 local topology before message passing. Features must match declared width and native model float32/64 dtype/device. Edges must reference existing local rows; they are cloned and transferred as long integers without rounding. Differentiable feature links remain connected through cloning. Extra `time_features` are explicitly unsupported; put actual time observations in the declared sequence rather than silently ignoring them.

Admission precedes graph replication and temporal attention. Limits are batch 64, nodes 4096, time 128, 2000000 feature/replicated-edge values, 32000000 temporal attention values, 8000000 spatial values and estimated point/parameter/edge work 256000000. These are library work policies, not precise memory/runtime or physical traffic estimates. Existing per-sample graph offsets, temporal LSTM prediction and PyG message passing remain unchanged.

## Serving output

Temporary evaluation restores every previous module mode on success/failure, without changing model weights or prior gradients. Predictions must retain finite [batch, nodes, horizon] identity. Mean and population standard deviation summarize each admitted node population; singleton spread is exactly zero. Both reductions use max-absolute scaling and float64 normalized intermediates to avoid overflowing a finite constant population, including float32 values 3e38 and float64 values 1e308. Outputs retain native dtype/device. This population spread is not calibrated forecast uncertainty; sample standard deviation semantics intentionally change to correction zero.

GATTrainer.predict uses the same native result under its existing state lock. The mounted predictor holds one trainer generation across policy checks, request graph construction, native serving and horizon metadata. It runs in a FastAPI worker; mounted train/save/load are also workers so waiting on that native lock does not block the event loop. Request cancellation is not model rollback. Direct external concurrent model calls and cross-process publication are not fenced by this contract.

## HTTP compatibility

Complete records require strict integer IDs and finite numeric observations, non-null traffic/speed and bounded road-type text. Sparse/negative public IDs still map to local tensor rows; existing feature units and undirected semantics remain unchanged. Body size and complete graph work are admitted before conversion. Malformed/unsupported serving admission is 422, unexpected native output failures remain generic 500. Build-graph still permits an empty graph; prediction requires a nonempty node population.

## Evidence and limits

Actual Torch/PyG batched outputs and feature gradients match independent per-sample native execution. Independent NumPy reductions match nonconstant native populations; singleton and extreme finite constant populations serialize correctly. Fractional topology, complete late nonfinite observations, replicated-edge/attention/work limits, caller mutation during native PyG callbacks, native failure mode restoration, full default ASGI and worker overlap are tested. Existing tensor, request-ID, checkpoint restore and native graph suites remain included.

CPU Torch 2.8 / PyG 2.6.1 float32/64 tested; CUDA admitted but untested. No model architecture/weights, training objective/checkpoint format/publication, extra-time-feature fusion, physical accuracy/calibration, providers/hardware, arbitrary external hook mutation or deployment claim.
