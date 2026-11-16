# Native diffusion example/context pairing

`DiffusionTrainer.train` uses one TensorDataset for each example and its context,
with one shared shuffle. Global context `[rows, features]` expands over sequence
positions; per-position context must already match the sample sequence shape.
TensorDataset tuple/list batches are decoded before calling the real model.

Conditional held-out evaluation now requires explicit `val_condition_data`
matching `val_data`; training context is never recycled into validation. Both
complete datasets validate before any optimizer update. Legacy direct
`train_epoch`/`validate` calls can use separate loaders only with sequential
samplers and identical row counts, batch sizes and drop-last boundaries. Callers
using independent shuffled loaders must migrate to one joint dataset.

Loss aggregates by sample count, including short final batches. Validation
restores the prior model mode on success or failure.

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q \
  backend/ml/tests/test_diffusion_paired_pipeline.py \
  backend/ml/tests/test_diffusion_trainer.py
python -m ruff check backend/ml/diffusion/trainer.py \
  backend/ml/tests/test_diffusion_paired_pipeline.py --select E9,F63,F7,F82
```

25 local tests pass with Torch2.8CPU and the actual DiffusionRouteModel and
AdamW optimizer, including native conditional parameter updates, source/context
row IDs through train/validation, legacy ordered tails, early rejection and a
numerical sample-weighted held-out loss. Identical new tests on unchanged source:
22 failures/1 pass. The two existing validation-threading controls also pass.

The model's condition projection is explicitly configured in conditional native
controls. Its separate lazy projection/replacement behavior is outside this
pipeline change, as are DDPM stepping, checkpoint publication, provider services
and production fits. This focused gate does not establish broad backend CI.
