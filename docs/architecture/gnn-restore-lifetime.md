# GNN model restore lifetime

The shared GNN optimizer restores model tensors and feature statistics privately
before publishing them with the trained flag under one short generation lock.
Malformed tensors or scaler metadata leave the old serving generation intact.
Scalers must have finite vectors of the expected node/edge dimensions, strictly
positive scale values, and a true fitted flag. Existing checkpoint keys and
normalization formulas are unchanged.

Route inference and checkpoint save capture one model/scaler pair under that
lock. They do not hold it during native Torch work or filesystem I/O. The eval
compatibility wrapper restores the mode of the model it originally owned,
rather than changing a newer model published while its reader was executing.

A separate native mutation lock serializes load and train through their actual
completion. Training fits a private model/scaler and publishes only on success;
this is necessary so a concurrent save or an already captured reader cannot
observe mutable tensors or training statistics halfway through a fit. It does
not change GNN optimizer state persistence, training targets, learning-rate or
validation behavior. Those existing policies and claimed training issues are
outside this change. No new cancellation guarantee is introduced.

The plain model/scaler attributes remain compatible with existing callers and
test seams. External mutation of those objects must be quiescent; trainer-owned
operations enforce the lifecycle described here. Native threads are not killed.
An old reader retains its model until it finishes, increasing peak memory during
private training or restore. Existing execution admission remains responsible
for concurrent native work. Publication coordination is process-local.

## Verification and upstream limits

The focused suite executes native Torch/PyG layers, local checkpoint I/O, Adam
training, an actual optimizer consumer on valid PyG graph data, and the actual
decorated load endpoint function with injected native optimizer state. The
endpoint source is imported directly, so this is not a full HTTP/router registry
integration test. Numerical checks cover retained old embeddings and checkpoint
weights; failure tests cover restore rollback and finite scaler admission.

Existing `test_gnn_feature_scaling.py` currently fails before model execution:
`get_pytorch_data` calls `extract_features(graph)` while an existing builder
override accepts no graph argument. Nonzero-hop path scoring also encounters an
unrelated override signature mismatch. The new consumer test uses native PyG
data and a valid zero-hop path to isolate actual model/scaler generation behavior.
These upstream failures are reported rather than included as passing gates or
fixed in this issue. The focused CI does not claim the full GNN service is green.
