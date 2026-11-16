# Multi-task checkpoint generations

MultiTaskTrainer now owns a single model/Adam/ReduceLROnPlateau generation. Checkpoint
restore validates privately: matching task configuration, exact finite model keys/
shapes/dtypes, native ordered Adam groups/flags, finite matching moment tensors and
nonnegative variance/counters, and compatible scheduler policy/history. Rejection
preserves active model/optimizer/scheduler identity, weights and predictions.

The native scheduler is included under `scheduler_state_dict`. Valid legacy checkpoints
with model_state_dict, optimizer_state_dict and matching task_config remain accepted;
when scheduler history is absent, a new default scheduler starts without inheriting
another training run's counters/best metric. Its last learning rate reflects restored
Adam. Explicit null scheduler state is invalid, not legacy absence. The initial +infinity
best/mode sentinel for min-mode scheduler is valid; NaN/negative-infinity best is not.
Configured task heads/optimizer order must match; this is not a task/topology migration.

The existing native default Adam configuration is supported. Capturable/differentiable/
decoupled-weight-decay execution modes and mutually enabled foreach/fused modes reject.
No GPU execution validation is claimed. Snapshot validation and publication operate under
one process-local RLock. Native training runs, steps, validation, prediction, scheduler
updates and snapshot capture own the generation. Whole `train` runs hold the lock, so
prediction/restore may wait for a long training run; no latency or cancellation guarantee.
No cross-process fencing or arbitrary external model mutations are covered.

A valid restore publishes private objects. Consumers must refresh `trainer.model`,
`trainer.optimizer` and `trainer.scheduler`; earlier external model references remain
retired and unchanged. One existing logits checkpoint consumer is updated accordingly.
The mounted single-task prediction route now uses trainer-owned no-grad prediction.
Prediction temporarily evaluates the admitted generation and restores each module's
prior mode, preserving classification probabilities and registered checkpoint keys.
Task configuration supplied to model construction is copied before head construction.

Save captures and validates an owned complete snapshot, releases the lock, serializes
it to an owned sibling temporary file, flushes/fsyncs and replaces the destination after
successful serialization. Training can progress during disk serialization without changing
the captured tensors. Failed serialization/replacement cleans only that temporary file,
preserving an earlier checkpoint. A nonfinite live generation cannot overwrite its last
valid file. This is atomic file replacement on the same filesystem, not complete power-loss
or filesystem-directory durability. Save requires an existing destination directory.

This repair does not make all optimizer transitions finite, reverse prior epochs, roll
back RNG, certify training quality, restore custom criterion parameters or prove full ML
bootstrap. Existing named dataset, classification logits and PCGrad layout repairs remain.
Tests use native CPU Torch2.8.0 and real filesystem/checkpoints/router requests; the
separate broad declared2.13.0 dependency stack is not verified. Native thread barriers
exercise checkpoint/training ownership; controlled serializer I/O failure injection
exercises the native file boundary without replacing numerical operators. One unchanged
legacy `test_mtl_init` omits the required tasks constructor argument and is deselected.
Existing AnyIO TestClient deprecation remains.
