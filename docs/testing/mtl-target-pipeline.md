# Named MTL training targets and atomic dataset admission

Training serializes and reconstructs targets in one canonical model-task name sequence. Dictionary insertion order cannot redirect a target to a different head. Before any epoch or optimizer/scheduler update, training checks the complete training and optional validation datasets: exact task keys, aligned nonempty rows, input feature count, floating dtype compatible with model parameters, finite values, regression width/dtype, and int64 classification index shape/range. Validation must be supplied as a complete pair; epochs and batch size must be positive integers.

This intentionally rejects malformed inputs earlier with ValueError. Valid public train/validate/predict outputs remain compatible. Direct train_step and prediction admission are outside this change. Classification loss/logit behavior and PCGrad surgery remain the independent PRs17171 and17169.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_mtl_target_pipeline.py
python -m ruff check backend/ml/mtl/model.py backend/ml/tests/test_mtl_target_pipeline.py --select E9,F63,F7,F82
```

35 native tests pass: shuffled batches of1/3/7, equivalent insertion-order regression and mixed heads, exact native Adam parameter/state equivalence, invalid full datasets against an already-trained optimizer, held-out admission failures, mode/scheduler preservation, and valid public controls. Unchanged current-main source fails32/passes3. Temporary integration of actual production sources with17169 and17171 passes65 combined tests/1explicit stale init assertion excluded. The35 target controls also pass with native PCGrad in that integrated source. The committed suite selects the native standard path to isolate target binding from the distinct PCGrad defect.

Focused Linux CPU CI executes these native tests. No production fit, provider, empirical model-quality or broad backend-CI claim.
