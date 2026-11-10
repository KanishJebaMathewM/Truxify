# MAML training transition admission

`meta_train_step` admits all tasks before differentiable support adaptation. Tasks must
be a nonempty list/tuple (up to256), each containing four dense real Torch tensors:
support features/labels, query features/labels. Feature rows must be nonempty and match
`input_dim`, at most4096 per set. Labels match rows and `output_dim`; one-dimensional
scalar labels normalize to a column. The complete batch is bounded to1048576 observation
values. Boolean/complex/sparse tensors and values that overflow the model dtype reject.

Inputs are detached and copied to the active model dtype/device. Training observations
are data, so this boundary does not preserve differentiation with respect to caller-owned
input tensors. The existing differentiable support update and second-order gradients
with respect to meta-model parameters remain connected. The existing equal-task average,
MSE objective, Adam policy and gradient clip1.0 remain unchanged.

Support objectives, adapted parameters, query predictions/objectives, the complete
meta objective and meta gradients must be finite. The active model and Adam state must
be finite before an update. `outer_update` captures prior model state, Adam state and
parameter gradients; after the real registered optimizer steps, it checks the resulting
state. Any rejected step restores those snapshots on the same registered pair. The
existing generation RLock owns validation, training, rollback, checkpoint replacement
and capture, so restore/save cannot observe an admitted partial outer transition.

`MetaTrainingInputError` identifies invalid task/count admission. `MetaTrainingTransitionError`
identifies failures of the current model/optimizer transition. The mounted `/meta/train`
request uses strict positive bounded integers: epochs1–10000, tasks_per_epoch1–256,
k_shot1–4096. Data admission errors return422; model/optimizer transition failures keep
the existing sanitized500 response. Epochs commit independently: a later failed epoch
does not undo prior accepted updates.

Limits: this is the native MAMLModel contract, not arbitrary side-effectful custom module
forward rollback. Snapshotting adds memory/copy cost; no speedup is claimed. Model/Adam
state and gradients restore, but RNG/dropout draws, task-generator state, external side
effects and completed epochs do not. Inference `adapt` and task-generation policies
remain their existing contracts. No GPU production load, prediction quality, global
worker coordination or full ML application bootstrap is certified.

The focused suite uses native CPU Torch2.8.0 and actual FastAPI router requests. It
includes an independent closed-form one-step linear MAML meta-gradient/Adam reference,
actual overflowing Adam candidate recovery, finite-gradient norm overflow, input
mutation during actual forward, full-batch rejection before RNG/optimizer work, and
existing checkpoint/private-inference/task-truth regressions. The unchanged legacy
`test_maml_init` expects nonexistent `MAMLModel.adapt` and is explicitly deselected.
Torch2.8.0 is the focused tested version; this does not verify the broader repository's
separate declared Torch2.13.0 dependency stack. Actual router loading bypasses unrelated
eager service initialization. Existing AnyIO TestClient deprecation warning remains.
