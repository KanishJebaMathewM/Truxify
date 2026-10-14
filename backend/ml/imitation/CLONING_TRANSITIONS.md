# Continuous cloning transitions

Continuous cloning retains its mean squared error, unclipped finite gradients, ordinary coupled Adam and row-weighted epoch means. Entire paired demonstrations are copied into native float32/64 geometry before random ordering or updates. Counts are integral and bounded (10,000 rows, 1,000 epochs, 2,000,000 row-epochs).

Each admitted batch owns the native model/Adam transition. Nonfinite output, objective, gradients, registered parameters or moments, and ordinary exceptions after a partial step restore the previous weights, moments, gradients, mixed module modes and registered parameter identities. Earlier accepted batches remain accepted. Invalid prior numeric state and unsupported optimizer configurations are rejected before training. A corrected ordinary configuration can be retried.

Training, continuous prediction, aggregate save and aggregate load share the cloning component lock. Native copies recreate independent locks. Prediction owns its observations and preserves mixed modes and gradients. Direct external forward calls and direct mutations are outside this fence; the aggregate checkpoint remains its existing multi-component operation and is not an atomic recovery transaction.

This does not change categorical policy gradients, inverse reward fitting, action mappings, whole-fit RNG recovery, checkpoint provenance or persistence durability. Custom callbacks, process cancellation, fatal device failures and cross-process writers are excluded. Tests use synthetic observations and local native tensors only; they establish no vehicle or behavioral quality claim.
