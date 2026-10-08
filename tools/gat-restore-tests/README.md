# Native GAT restore transaction

Python3.12 / CPU Torch2.8.0, install requirements.txt then:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_gat_restore_transaction.py
```

Restore copies the model and Adam in one memoized deepcopy, loads and validates
both privately, then publishes one pair reference. Failed partial model loads,
invalid optimizer groups/moments or nonfinite state leave the exact serving model,
optimizer, parameter values and moment values unchanged. Public model/optimizer
read access and checkpoint dictionary format remain intact; repository callers
do not assign these trainer attributes externally.

A native RLock serializes trainer train/train_step/validate/predict/save/load;
full training can nest train_step. This is a restore consistency protocol, not
private-fit publication or native executor cancellation/admission. Candidate
publication temporarily requires a second model/optimizer allocation. Direct
model access bypasses trainer serialization as before; load alone never mutates
a captured previous model. Prediction routes remain synchronous native operations.

Tests use actual SpatialTemporalGAT model tensors and actual Torch/Adam. A small
real Linear network isolates native Adam trainer restoration from the existing
main GAT tensor-shape defect addressed by17106. Checkpoint state validation,
next-step equivalence, staged load readers and native save/load serialization are
covered. No full GAT/ASGI/provider/training service pass claim from this gate.

Temporary integration of17106/17108 requires resolving one same-location method
insertion: retain both pair properties and _prediction_targets, then keep the
native serialization decorator directly on train_step. The resolved actual
sources pass66 combined native tests; no branch or upstream merge is performed.
