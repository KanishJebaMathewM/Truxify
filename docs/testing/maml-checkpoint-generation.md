# MAML checkpoint generation ownership

`MAML.load` validates an owned native model/Adam pair before replacing the active
pair. Exact model key/shape/dtype/finite checks and Adam parameter ordering,
finite moments, nonnegative second moments, scalar integer steps, groups and
execution flags precede publication. Rejected loads preserve the active model,
optimizer, existing gradients and predictions. Compatible legacy checkpoints may
omit optional Adam flags; required model/Adam tensor state remains mandatory.
Custom parameter groups, tensor-valued learning rates, capturable/differentiable
Adam and decoupled weight decay are not supported by this MAML constructor.

The process-local reentrant fence covers each complete meta-training step,
outer update, adaptation, prediction-mode operation, restore validation/publication
and snapshot capture. Long multi-epoch training can admit a new generation between
steps. This does not add cross-process synchronization, inference scheduling or
nonblocking FastAPI execution. Direct mutation through external module/optimizer
references is outside the managed lifecycle.

Successful restore replaces module/optimizer identities together. Access the
current module via `maml.model`, not an earlier retained constructor reference.
Existing adapted models retain their original private module and differentiable
parameter links. A retired adapted loss cannot step the replacement optimizer:
`outer_update` resolves gradients against its admitted current parameters before
clearing/stepping Adam. The mounted model-info route reads the current module.

Save captures deep-owned tensors under the fence and then releases it during I/O.
A sibling temporary file is serialized, flushed and fsynced before `os.replace`.
Failed writes leave the previous file and clean only the created temporary file.
Concurrent saves are atomic last-writer-wins; no generation-order persistence or
power-loss directory durability is promised. Destination directories must already
exist. Checkpoints still use the existing two-key dictionary and weights-only load.

## Native controls

```
python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install numpy==1.26.4 pytest==9.0.3 pytest-asyncio==1.4.0 ruff==0.16.9 fastapi==0.116.1 httpx==0.28.1
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_maml_checkpoint_generation.py backend/ml/tests/test_maml_inference_contract.py backend/ml/tests/test_meta.py -k 'not test_maml_init'
python -m ruff check backend/ml/meta/model.py backend/ml/routes/meta_routes.py backend/ml/tests/test_maml_checkpoint_generation.py --select E9,F63,F7,F82
```

40 native tests pass, including16 malformed checkpoint cases, an independent
functional second-order/Adam replay, owned snapshots during actual training,
controlled restore overlap, retired-loss rejection and actual ASGI load rejection.
The unchanged `test_maml_init` asserts `MAMLModel.adapt`, while adaptation belongs
to `MAML`; that single stale contract is explicitly deselected. All other existing
meta-gradient and inference controls are included. Full monorepo gates and GPU
execution are not claimed; no synthetic task or second-order algorithm change.
