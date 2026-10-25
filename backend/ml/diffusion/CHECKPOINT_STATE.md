# Owned native diffusion trainer checkpoints

`DiffusionTrainer.save_checkpoint` captures owned model/native AdamW/loss histories.
Unused `cond_proj.weight/bias` are represented by paired plain dictionary markers,
so fresh and unconditional training checkpoints reload with ordinary Torch loading.
Materialized keys and the existing model/optimizer/history/timestamp fields remain.
New deferred markers need the new trainer reader; old unsafe-object or missing
projection checkpoints require explicit recreation/migration. No unsafe-object
fallback is added. Standalone generator exports retain their prior warmup requirement.

The receiver privately validates complete registered keys/geometry, paired deferred
condition schema or valid first materialization, finite real values after native
conversion, canonical single-group AdamW policy/binding/moment shapes/integral counters,
nonnegative variance/AMSGrad maxima and finite nonnegative owned MSE histories.
The native beta/alpha/cumulative-alpha schedule must have valid finite probabilities
and coherent relations. Relation tolerance rtol2e-5/atol2e-7 preserves existing buffers
converted from float32 to float64; it is not an empirical route-quality calibration.

Only a complete verified private candidate is copied into existing model/parameter/
optimizer/buffer objects. Existing generator buffer aliases and optimizer parameter
references remain. First condition materialization retains parameter identity and
correct projection width; ordinary publication failure restores prior deferred class/
data, registered values, groups/moments, histories, gradients and mixed modes directly.
Publication runs no forward pass, so native lazy initialization hooks remain available
for retry. A valid incoming checkpoint can repair corrupt old numerical state.
A deferred checkpoint cannot reset an already materialized receiver schema; incompatible
materialized condition widths are rejected before live mutation.

Owned trainer train/step/epoch/validation/generation/save/load methods share one
reentrant lock. Existing17869 training admission/recovery and17847 denoiser admission
require deliberate integration retaining one lock and their own native contracts.
Their valid first conditional initialization remains before timestep/noise RNG;
checkpoint restoration adds no numerical training step or fabricated observations.

## Limits

Registered tensor values<=32000000; each loss-history list<=100000. These admission
counts are not a file-size/time/full-memory bound. Private preparation/snapshots and
owned tensors/moments add memory overhead. Ordinary canonical single-group native
AdamW only; custom optimizer/group metadata/hooks, capturable/differentiable/fused
policy, unsupported custom lazy buffers/topology changes and external mutation excluded.
CPU float32/64 tested; CUDA admitted untested. Registered values/state conformance
cannot prove historical provenance or all future training/forecast stability.

No external-generator reader transaction, RNG/whole-epoch/cross-process/fatal-device
rollback, disk crash atomicity, signed artifact/path-security/provider/camera/vehicle
change or physical route-quality claim. Assigned13876 endpoint geometry stays separate.
The native workflow verifies the Torch2.8.0 baseline and actual repository requirement
pin, with independent next-step MSE/AdamW and genuine deferred/recovery/schedule controls.
