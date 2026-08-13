## Problem

In `backend/ml/diffusion/trainer.py`, `train()` calls `self.validate(val_loader)` but `validate()` (lines ~148-166) never consults the `condition` loader that `train_epoch` uses. `train_epoch` appends the condition batch to the model input (`x_noisy = torch.cat([x_noisy, condition], dim=-1)`), yet `validate` builds its batches from `val_loader` alone, dropping the conditioning signal.

For conditional diffusion models this means training conditions on `condition_data` while validation silently ignores it, producing train/validation skew: the validation loss measures an unrelated (unconditional) objective, so early stopping / checkpoint selection is driven by a mismatched metric.

## Fix

- Threaded the condition loader through `validate(val_loader, condition_loader=None, require_condition=False)` and, inside the validation loop, rebuild the same `(x, condition)` input used by `train_epoch` (1:1 channel layout, including the cyclical condition iterator).
- `train()` now passes `condition_loader` to `validate` and sets `require_condition=(condition_loader is not None)`.
- `validate` raises `ValueError` when `require_condition=True` but no `condition_loader` is supplied.

## Files changed

- `backend/ml/diffusion/trainer.py`
- `backend/ml/tests/test_diffusion_trainer.py` (added `TestDiffusionValidateCondition`)

## Testing

- `python -c "import ast; ast.parse(...)"` for syntax validation.
- `pytest backend/ml/tests/test_diffusion_trainer.py` passes (2 passed):
  - `test_validate_raises_when_condition_required_but_missing` asserts `validate` raises `ValueError` when condition is required but missing.
  - `test_validate_threads_condition_into_model` asserts the condition is actually concatenated into the model input via a `denoise` spy.

Closes #11389
