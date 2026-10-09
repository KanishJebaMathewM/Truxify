# Native categorical policy transitions

PolicyGradient retains its registered public Softmax and stable selected-row log_softmax REINFORCE objective. Whole-population reward normalization and global gradient clipping at 1.0 remain unchanged. No category-to-continuous-control mapping or new reward algorithm is added.

Direct steps own complete states/actions/rewards before forward work. Native float32/64 CPU or CUDA parameters determine observation precision and device. Actions remain integral categorical indices; column rewards normalize to one scalar per row. Complete trajectories, epochs/batch sizes and total row-work are admitted before shuffle, dropout or the first update. Bounds: 10,000 total rows, 1–1,000 epochs, batch size 1–10,000, and 2,000,000 row-epochs. These counts do not bound wall time or all allocation costs.

Actual objective/gradient/global norm and resulting registered parameters/native Adam moments must be finite. The shared native optimizer transition snapshots prior registered values, moments, gradients and mixed module modes. An ordinary exceptional/nonfinite step restores them without replacing parameter objects. Earlier accepted batches remain; histories describe completed epochs only. Ordinary ordered native Adam with nonfused/noncapturable/nondifferentiable options is supported; existing finite optimizer policy and state are admitted before stochastic work.

Training, scalar categorical inference and aggregate checkpoint policy-component access use one process-local reentrant operation lock. Inference temporarily evaluates and restores prior mixed modes, retains gradients and returns the existing Python integer category. Copies receive independent locks; native parameter deepcopy still does not copy gradients. This does not make aggregate checkpoint publication atomic or add policy optimizer resume fields. Existing external advisory readers are outside this fence unless explicitly composed under it.

Snapshot/input-copy memory costs remain. Whole-fit/RNG/shuffle/dropout state, custom optimizer/hooks, external model writers, cross-process/fatal device recovery, crash-atomic storage, CUDA execution verification, future numerical stability, provider/vehicle controls and empirical recommendation quality are not claimed. CPU float32/64 native tests run on baseline Torch 2.8 and the exact requirements pin 2.13; CUDA is admitted but untested.

Focused command:

```sh
OMP_NUM_THREADS=1 PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_policy_transition.py backend/ml/tests/test_imitation.py backend/ml/tests/test_cloning_objective.py backend/ml/tests/test_reinforce_logit_contract.py -q
```

Independent native objective, clipped derivative and first-Adam formulas plus actual multi-batch population normalization references verify accepted work. Real finite-policy moment overflow, post-native-step failure/retry, caller mutation, late malformed trajectory, prior accepted batch and blocked inference/checkpoint consumers verify failure ownership. Existing mounted synthetic training stays synthetic; no production training or physical safety assertion.
