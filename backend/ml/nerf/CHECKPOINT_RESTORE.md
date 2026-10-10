# Owned native NeRF checkpoint restore

`NeRFTrainer.load` retains the existing two checkpoint keys and prepares an owned
private network/native Adam pair before changing registered live values. It admits
complete finite real model tensors with exact registered shapes, a single canonical
ordered parameter group, supported finite Adam policy, and complete initialized
scalar-step/first-moment/second-moment tuples. Uninitialized parameters may have no
state. AMSGrad requires finite correctly shaped maxima dominating second moments.
Native dtype/device conversion is performed privately and the converted state is
checked again: a finite float64 source that overflows float32 is rejected.

Publication copies into the existing network, parameters and optimizer, preserving
renderer references. Ordinary publication exceptions restore prior registered values,
optimizer groups/moments, gradients and mixed modes directly, without reusing the
failed load hook. Invalid prior numerical state can be repaired by a valid incoming
checkpoint; it need not pass candidate admission. Source tensors cannot alias the
published pair. Existing native parameter keys and valid float32/64, initialized or
lazy Adam, AMSGrad and ordinary cross-dtype continuation remain supported.

Train, nested train-step, save and load use one per-trainer reentrant operation lock.
This is a process-local trainer protocol, not a reader guarantee for arbitrary
external network/renderer access. Existing #18014 training and #17808 explicit ray
objective/route-worker ownership share these methods; integration must retain one
lock and their separate admission/update/rendering semantics. No model-root swap.

## Limits

Only ordinary native Adam's single canonical group is supported, including ordinary
foreach and maximize/decoupled-weight-decay flags. Capturable, differentiable and
fused policy, custom optimizer/group metadata/schedulers/hooks, registered topology
mutation and external writes are outside this contract. This protocol verifies native
state conformance, not historical checkpoint provenance, future gradient stability
or scene quality. It does not dry-run an update or fabricate observations.

Private preparation and recovery copies cost model/moment memory. `torch.load` and
snapshot allocations are not a calibrated file-size/memory bound. No disk crash
atomicity, signed artifact/path security, RNG/whole-epoch/cross-process rollback,
fatal device recovery, production camera/vehicle or provider changes. CPU float32/64
are tested; CUDA conversion is admitted but untested. Gradients and modes are not
checkpoint fields and remain those of the live receiver on ordinary success.

## Verification

Run the workflow's native CPU suite on both the reproducible Torch2.8.0 baseline
and the exact Torch version extracted from backend/ml/requirements.txt. It uses genuine Torch network, MSE and Adam;
independent direct next-step references, malformed complete state/cast controls,
late-key/group errors, real renderer identity, private source ownership, corrupt-old
repair, publication faults/retry and operation ordering accompany existing NeRF
volume/camera/image checkpoint consumers. Fault injections occur after genuine native
publication; numerical model/optimizer work is not substituted.
