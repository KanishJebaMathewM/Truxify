# Transformer trainer generations

`TransformerTrainer` fits a private model, then publishes a complete model and
optimizer pair with one reference replacement. Published models stay in eval
mode and trainer operations never update their tensors. Prediction and
validation capture one model before running native Torch work; a caller timeout
cannot make an already executing forward pass observe another generation.

A native `RLock` serializes train, train_step and load through completion. The
lock belongs to native work and outlives an async caller's route lock. Readers
continue using the current complete model while a private fit is in progress.
The existing cancellation check remains immediately before training publication.
A cancelled or failed fit leaves the serving pair intact.

Checkpoint save captures one generation and serializes that model and optimizer.
Checkpoint load restores both into a private pair before publication, so failed
optimizer restoration cannot publish a partially loaded model. Existing two-key
checkpoint files remain compatible. Optimizer parameters always belong to the
model in the same generation; state is carried forward across successive fits.

The readable `model` and `optimizer` properties remain available. External code
must not mutate their objects; this invariant applies to trainer-owned methods.
Publication retains the existing device and route contracts. Native threads are
not forcibly terminated: the shared execution layer controls admission, and old
models stay alive as long as an admitted native reader owns them. Private fitting
and simultaneous old readers increase peak memory; this change adds no queue or
provider calls. Changes to unrelated Traffic/Price forward implementations are
outside this issue.

## Verification

The focused suite uses real CPU Torch layers, AdamW, checkpoint I/O and a small
DemandForecastTransformer. Gated native layer execution verifies that an ongoing
prediction retains old weights while train, train_step or load publishes. Tests
also cover failure/cancellation, concurrent training state continuity, snapshot
checkpoint ownership and actual transformer fit/validation/restore. The dedicated
workflow installs Torch 2.8 from the official CPU wheel index and tests only these
native operations, without optional GNN/provider dependencies.

The focused gate also runs the three existing native transformer tests. Their
route import is delayed until the request-schema test that needs it; that one
route-registry test is explicitly deselected because it requires optional GNN
dependencies. This does not disable the schema test in the full ML suite.
