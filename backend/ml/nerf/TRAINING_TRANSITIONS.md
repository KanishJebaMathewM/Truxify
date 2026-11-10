# Native NeRF training transitions

The standalone trainer owns complete point/direction/target RGB tensor copies
before changing modes or clearing gradients. Full collections, matching row
geometry, finite compatible float32/64 values, target RGB in [0,1], representable
Fourier inputs and count/work policy are checked before shuffling or fitting.
Pointwise directions remain raw encoding inputs; this API does not reinterpret
points as origins or learn density from rays.

Limits: 100,000 points, 100 epochs, 100,000 rows per collection batch (default4096), 10,000,000
point-epochs. These are invocation admission bounds, not calibrated latency or
complete model memory limits. The direct step admits up to 100,000 rows. Invalid
prior native Adam policy/model state is rejected before collection shuffling.

Each native update reuses the existing optimizer-only transition protocol in
`foundation.optimizer_transition`. Actual objective/derivatives and resulting
registered model/buffer/moment tensors must be finite before success. Ordinary
exceptions and nonfinite candidates restore prior registered values, moments,
gradients and mixed module modes without replacing parameter objects. Accepted
earlier batches remain; callers may correct policy and retry. Native MSE and Adam
math are retained, without introducing gradient clipping or a different objective.

Train, direct train steps, save and load share a trainer reentrant lock. This
prevents the trainer's own save/load from interleaving a native update. It does
not add atomic checkpoint restore or a serving-generation protocol. Independent
renderer access/direct external parameter mutations are outside this lock.

For source composition with #17808, retain its `train_rays` method, full owned
ray admission, differentiable volume law and route worker ownership. Decorate the
named trainer operation with the same lock; wrap its existing model train,
zero-grad, rendered-MSE/backward and Adam step in `optimizer_transition`; admit
prior native state before its shuffle. Keep named ray metadata and pointwise
metadata. No changes to cameras, sampling, infinite tail, detach defaults or
rendered density/color derivatives are needed. Shared method changes require
explicit merge resolution rather than mechanically replacing one branch.

Snapshots add memory proportional to registered model and existing native Adam
moments. Recovery is ordinary process-local native Adam only; arbitrary hooks,
custom optimizer classes, external mutation, RNG/whole-epoch rollback, concurrent
external rendering, process/device fatality, cross-process publication, real scene
quality, cameras, providers and physical controls are not covered. CUDA admission
is implemented but the focused evidence uses native CPU float32/64 only.
