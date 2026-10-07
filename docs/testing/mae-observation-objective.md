# MAE masked observations and optimizer admission

Bernoulli token masks remain unchanged. Nonempty selections use exact mean squared reconstruction error across selected tokens/features. Empty selections use finite differentiable zero with zero parameter derivatives rather than the undefined mean of an empty tensor. Lower-precision masked MSE accumulates in float32.

MAE pretraining skips backward/AdamW/weight decay on no-observation batches. Existing loss/history/method fields remain and additive observed_batches/skipped_batches counters identify histories with no training signal. Gradients are cleared before the decision; already-trained parameter values and AdamW moments/steps remain unchanged on skipped batches.

The complete admitted dataset and finite mask ratio[0,1] are validated before epoch updates: nonempty batch/tokens, feature width, finite floating model-compatible dtype/device and positive integer loop controls. Pretraining moves data to its configured model device once. Prediction reconstruct API and checkpoint topology remain.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_mae_observation_objective.py backend/ml/tests/test_self_supervised.py
python -m ruff check backend/ml/self_supervised/model.py backend/ml/tests/test_mae_observation_objective.py --select E9,F63,F7,F82
```

34local native tests pass; unchangedmain fails23/passes10 new tests. Independent actual sampled-mask reconstruction/loss and parameter gradients cover ratio0/0.25/1 with native random seeds, scalar-empty/single-token and lower-precision backward. Already-trained AdamW weights/moments are preserved for nine unobserved batches; complete invalid dataset preflight has no optimizer mutation. Native full-mask training, history counters and checkpoint roundtrip pass. Temporary actual-source integration with separate SimCLR17177/MoCo17181 fixes passes101 tests.

No forced mask, architecture/checkpoint keys, augmentation change, provider or production fit. Focused native Linux CPU CI only; no broad backend CI claim.
