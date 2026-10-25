# Native diffusion training observations and transitions

`DiffusionTrainer` owns complete train/held-out tensor pairs before native updates. Real diffusion inputs are dense finite `[rows, sequence, input_dim]` float32/64 tensors on the model device; contexts are aligned per-row or per-position model-dtype tensors with the registered width. Appended training features are not latent targets: provide separate conditions. Generic native test consumers retain aligned 2D tensors. Joint shuffle, short tails and independent validation conditions remain supported. Legacy separate loaders must retain existing sequential alignment.

Admission bounds are 2048 rows, 512 sequence positions, eight million owned values, 256 million estimated dense projection visits and 32 million attention entries per complete tuple (epoch count included); epochs are integers1..512 and configured minibatches1..64. Native model snapshots are capped at32million values before cloning. Loader traversals are fully owned under aggregate row/value/projection limits before their first update. These conservative policies may reject formerly accepted large jobs; use smaller explicit native jobs. They are not measured memory/latency guarantees. CPU float32/64 tested, CUDA inputs admitted but untested.

Each ordinary native AdamW step checks finite prior state/policy, denoising predictions/MSE, gradients/global clipping and resulting model weights/optimizer moments. An ordinary exception or nonfinite candidate restores prior registered weights, moments, gradients and mixed module modes without replacing parameter identities. Earlier accepted steps stay accepted; failed epochs publish no history entry. Validation owns all batches, preserves mixed modes and reports finite sample-weighted losses. Histories remain cumulative, while a current call without validation reports `final_val_loss: null`.

A trainer-local reentrant fence owns nested training/validation operations. It does not coordinate the separate generator, HTTP handlers, external direct model writers or other processes. Native first condition projection materialization is an admitted initialization boundary: its registered identity and initialized values remain if a subsequent optimizer step fails. Unused lazy parameters stay uninitialized. RNG, loader sampling, whole-epoch rollback, custom optimizer/hook behavior and physical route quality are outside the contract. The HTTP training endpoint remains its existing synthetic demonstration; this change does not add an observed-route API or production fitting.

The native kernel, model architecture, reverse schedule, checkpoint keys and other-assigned #13876 geometry are unchanged. Open #17847 adds model/Fourier input admission separately; temporary actual-source integration verifies their shared consumers.

## Verification

```sh
OMP_NUM_THREADS=1 PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_diffusion_training_transition.py backend/ml/tests/test_diffusion_paired_pipeline.py backend/ml/tests/test_diffusion_trainer.py backend/ml/tests/test_diffusion_condition_ownership.py backend/ml/tests/test_diffusion_reverse_schedule.py backend/ml/tests/test_diffusion.py -q
```

Actual denoisers and AdamW are used. Independent sum-of-squares MSE, gradients/global clipping and first-step AdamW weight/moment calculations cover float32/64 and conditional/unconditional cases. Real finite-policy overflow/recovery/retry, ordinary post-native-step failure, complete malformed held-out/loader admission, caller mutation, lazy identities, earlier accepted steps and blocked worker ownership are checked. Existing pairing/condition/reverse consumers remain in the gate.
