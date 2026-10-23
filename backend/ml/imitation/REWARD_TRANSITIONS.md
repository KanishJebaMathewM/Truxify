# Owned inverse reward fitting

The existing inverse reward objective remains `-mean(expert_rewards) +
mean(learner_rewards)`. State/action pairs are required within each population;
expert and learner populations may have different sizes. This is the existing toy
reward estimator, not a new normalized/regularized IRL or calibrated safety algorithm.

Complete finite numeric compatible observations are cloned to the actual reward
network float32/64 dtype/device before fitting. Complex/bool, empty/ragged/wrong
width/unpaired rows and overflow on native conversion are rejected before changing
modes, gradients or dropout RNG. Each population admits1..10000rows; epochs1..1000;
combined row-epochs<=2000000. Default synthetic route1000rows/100epochs remains
admitted. These count bounds are not calibrated time/full-memory guarantees.

Each epoch deliberately enters training mode, evaluates genuine expert/learner scalar
reward rows, verifies the original native objective and derivatives, then uses the
existing native optimizer transition protocol to verify registered values/moments.
Ordinary native exceptions/nonfinite candidates recover prior values, moments,
gradients and mixed modes without replacing parameters. Earlier accepted epochs
remain; a corrected policy/input may be retried. No clipping algorithm is added.

Training and owned scalar inference share a reentrant reward-component lock.
Inference evaluates a single owned observation in eval/no-grad and restores prior
mixed modes even on failure. Aggregate save/load hold this lock through existing
checkpoint operations so their reward-component access cannot interleave with fitting.
Cloning and categorical policy components retain their independent behavior; this is
not an all-component checkpoint transaction. Existing checkpoint keys/formats remain,
and they still do not save the IRL optimizer. Deep copies reconstruct their own lock
while copying native state; no process-shared ownership is claimed.

## Scope and cost

Owned populations and registered/optimizer snapshots require additional memory.
Native Adam only, ordinary process-local reward operations; no custom optimizer/hooks,
external mutation, whole-fit/RNG/cross-process/fatal-device rollback or checkpoint
restore atomicity. Native route synthetic data remains synthetic. No provider, real
expert-driver quality, physical optimality, calibrated safety or vehicle action/control
claim. CPU float32/64 tested; CUDA admitted but untested. No provider/hardware is used.

Actual-source17812 integration retains its categorical/continuous advisory separation,
owned rule observations and mounted422/500 behavior. Shared source edits require
explicit merge integration; this repair does not change those advisory semantics.
