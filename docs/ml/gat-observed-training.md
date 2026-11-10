# GAT training from observed horizons

`POST /gat/train` now requires `targets` records, each containing a strict integer
`node_id` and a finite real `values` array for the model's complete prediction
horizon. Every public graph node must appear exactly once; target order may differ
from node order. The service builds targets in the captured graph's native row
order. There is no random target fallback. Results identify `provided_observations`,
`node_ids`, and `horizon`; this records caller provenance, not verified forecast
quality or a physical traffic dataset.

```json
{
  "nodes": [{"id": 20, "lat": 0, "lng": 0}],
  "edges": [],
  "targets": [{"node_id": 20, "values": [1, 2, 3, 4, 5, 6]}],
  "epochs": 1
}
```

Graph-only training calls now return422. Epochs are strict integers1–16,
default1; the prior HTTP50/Python100 defaults no longer apply. The training body
rejects unexpected top-level fields. Target horizon must match the current model
under its existing generation lock. Target units are the supplied regression
units; no conversion, calibration or acquisition is invented. Inherited graph
builder row identity, units and undirected topology remain unchanged.

The Python trainer accepts owned dense float32/64 features matching model dtype,
integer local edge topology, and finite targets shaped `[batch,nodes,horizon]`
(or `[nodes,horizon]` for one graph). Features may be `[nodes,F]` or genuine
`[batch,nodes,time,F]`. Complete optional validation data and targets are admitted
before any accepted epoch. Raw graph/target tensors are copied and detached from
caller autograd; this is a supervised training contract, not a feature-gradient
API. Inputs must fit declared bounds: batch64/nodes4096/time512/edges65536,
8million feature+target values, 4million registered model values, 1million
replicated edges, 32million temporal-attention entries, and256million
`batch*nodes*time*parameters*epochs` visits **per train or validation tuple**.
These bounds are work policies, not latency or allocation guarantees; body parsing
still precedes service admission. The HTTP graph/work plan precedes target tensor
construction. The Python horizon is enforced for the declared SpatialTemporalGAT;
small native test networks without that metadata also undergo exact prediction
shape checking before backward.

Each ordinary native Adam step snapshots registered state/moments and prior
parameter gradients/mixed module modes. Native predictions/MSE, gradients,
stock clipping norm/clipped gradients, and post-step registered model/Adam values
must be finite. Overflow or an ordinary native exception recovers those values
without replacing model/optimizer/parameter identities. Earlier accepted epochs
remain accepted if a later step fails. Prior modes are restored on success and
failure; successful training gradients remain those of the accepted step.
Validation uses native no-grad inference and preserves prior modes/gradients.
A numerical validation failure after an accepted epoch does not roll that epoch
back. Reported losses are actual native objectives, not synthetic observations.

The mounted native training handler uses a FastAPI worker and holds the existing
trainer generation fence through graph/target preparation, fitting and metadata.
Malformed/unsupported observations produce422; actual numerical/internal failures
produce generic500. Snapshot copies have bounded but additional memory cost.

## Evidence and limits

Tests use actual Torch/PyG GAT, temporal attention/LSTM and Adam. An independent
MSE/global-clipping/first-Adam reference, float32/64 and temporal batching, node-ID
permutation, complete-tail admission, genuine finite Adam moment overflow and
finite-objective/finite-gradient stock-norm overflow, registered-state recovery,
caller mutation, earlier accepted step, existing checkpoint/tensor/topology and
mounted worker consumers exercise the contract. No model architecture or serving
population kernel is changed.

Ownership is process-local through this trainer. RNG/whole-epoch rollback, custom
hook side effects, direct external mutation, cross-process writers, providers,
physical prediction quality and CUDA execution are excluded. CPU is verified;
CUDA conversion follows the prior trainer path but has not been tested. Existing
checkpoint publication and open serving repair#17843 remain separate contracts;
its actual source is included in a temporary integration gate.
