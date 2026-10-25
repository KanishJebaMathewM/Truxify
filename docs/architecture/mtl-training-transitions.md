# Native MTL training transitions

The direct `MultiTaskTrainer.train_step` entry point previously admitted a NaN
target and poisoned model weights. A separate native control has valid finite
data, loss `1.0` and finite gradients, but a large latent activation makes the
actual Adam squared-moment candidate infinite. Neither reporting a finite loss
nor later refusing a corrupted checkpoint repairs that transition.

## Admission and transition ownership

The existing generation RLock encloses the full step. Before changing training
mode or previous gradients, the trainer admits exact task/loss names, finite
nonnegative weights, a supported method and an owned compatible finite batch.
Native `MultiTaskModel` input/target dimensions and class labels reuse the
existing named-target validator. Compatible custom tensor-state models retain
their criterion-defined target geometry, with exact names and finite values.
Caller mutation after the completed tensor/policy snapshot cannot change the
admitted forward/backward operation; mutation during the copy is unsupported.

A private pre-step snapshot owns registered model state, native Adam state,
previous gradients and every module's training flag. Each task loss and weighted
objective must be a finite floating scalar. Derivatives must be finite before
the actual optimizer runs. The actual resulting model and Adam moments must
remain finite and squared moments nonnegative before success is returned.
On an ordinary rejected/failed transition, restore the prior snapshot while
retaining the model/optimizer/scheduler identities. A predict/checkpoint reader
using the same fence cannot observe the failed candidate. Successful steps keep
the existing native derivative, weighting and optimizer behavior.

## Limits and compatibility

- Maximum 64 tasks, 2 million input-plus-target values per step and 8 million
  registered model values in a snapshot. These are work/memory admission policies,
  not measured latency or GPU memory guarantees.
- The mounted synthetic training request accepts strict integer epochs `1..100`,
  batch size `1..8192`, data size `1..50000`, and at most 1 million sample epochs.
  Defaults remain valid. Invalid client counts/admission return 422; internal
  candidate failures remain a generic 500.
- Native Adam tensor state is required. External optimizer/model topology changes
  or custom arbitrary state objects are unsupported. Custom criterion, forward
  or hook side effects outside registered model/Adam state are not recovered.
- Legacy `grad_drop`/`mgda` method strings preserve their existing standard-backward
  dispatch; this PR does not implement their separate algorithms. Unknown strings
  are rejected. New numerical PCGrad projection is separately reviewed in #17793.
- Recovery covers one step's ordinary failures, not an entire epoch, previous
  accepted minibatches, process crashes, asynchronous cancellation or RNG replay.
  Dropout/random draws may advance before a rejected step. Scheduler updates after
  a completed epoch are unchanged. Already-corrupted initial state is refused,
  not automatically repaired.
- CPU Torch 2.8.0 is verified. No production training data, providers, GPU fit,
  full declared dependency stack/bootstrap or trained prediction quality claim.

## Native evidence

The focused suite runs actual MTL models, autograd and Adam: finite-loss/moment
overflow on both standard and PCGrad paths, native sqrt's nonfinite derivative,
native optimizer post-step exception, registered-buffer recovery after a callback
failure, prior gradient/mixed-mode preservation and accepted continuation against
an independent native autograd/Adam reference. Actual mounted route requests and
thread barriers verify strict admission and fenced prediction after recovery.
Existing logits, named-target and checkpoint consumers remain in the Linux suite.
The actual pending numerical source from #17793 and this source also integrate
with 173 native tests passing, one explicitly unchanged init fixture deselected.
