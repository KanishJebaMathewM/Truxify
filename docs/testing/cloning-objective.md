# Continuous behavioral-cloning training objective

The existing registered BehavioralCloning/Adam now admits a complete owned finite dataset before training: states[N,state_dim], continuous actions[N,action_dim], equal positive row counts, and positive integral epochs/batch size. Column targets no longer broadcast across action outputs. Inputs convert to the existing model dtype/device and are detached/copied. Invalid data preserves parameters, optimizer moments, existing gradients, mode and NumPy/Torch RNG state.

Valid training explicitly enters train mode (including existing dropout), regardless of preceding prediction. Each step checks finite MSE and gradient norm before Adam. Epoch losses weight batch mean MSE by row count, preventing a short tail from dominating the reported metric. Registered module/parameter/checkpoint keys remain unchanged; no network is replaced.

## Focused native gate

With Python3.12/CPU Torch2.8, NumPy1.26.4, pytest9.0.3/pytest-asyncio1.4.0/Ruff0.16.9 and the existing FastAPI/httpx route dependencies:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_cloning_objective.py backend/ml/tests/test_reinforce_logit_contract.py
python -m ruff check backend/ml/imitation/model.py backend/ml/tests/test_cloning_objective.py --select E9,F63,F7,F82
```

44 tests pass:21new native cloning controls +23existing categorical REINFORCE controls. Unchanged main fails20/passes1 of the new tests. Independent Adam replay and row-level squared-error references cover float32/float64 and batch sizes1/2/3/9; invalid late rows, singleton and registered identity are checked. Device handling is implemented; this gate uses CPU, not GPU validation.

## Limitations

Valid training changes dropout/RNG behavior after prior inference, and row-weighted metrics differ from the old equal-batch mean. This is a continuous regression target contract, not categorical policy fusion or driver-safety policy. REINFORCE, inverse RL, action fusion, safety, prediction input conversion and checkpoint publication remain outside scope. Finite-step guards do not roll back previous valid batches if a later forward/gradient fails, and do not guarantee optimizer arithmetic cannot overflow for arbitrary trained states. No actual driver/production training, certified controls or model-quality benchmark is claimed.
