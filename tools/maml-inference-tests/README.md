# Native MAML inference contract

Python3.12 / CPU Torch2.8.0, install requirements.txt then:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_maml_inference_contract.py backend/ml/tests/test_meta.py -k 'not maml_init'
```

Actual functional_call/autograd and MAMLModel dropout layers verify scalar label
rows versus explicit column labels, repeatable regression/classification, private
module modes, original weight/mode/RNG preservation and second-order gradients.
The two existing meta-training gradient/loss controls remain passing. Actual
local FastAPI ASGI few-shot requests cover repeated prediction and support-label
row-count body validation422. The stale legacy initialization assertion that
MAMLModel itself has adapt remains explicitly deselected; adapt belongs to MAML.

Functional adapted parameters keep original autograd links; the functional module
has privately owned modes/buffers. Default adaptation preserves the caller's
training mode, while FewShotLearner explicitly requests private evaluation during
support adaptation and prediction. Scalar targets are expanded only for a single
output column; all other shape mismatches raise rather than broadcast losses.
Prediction restores the supplied module's prior mode. Private copies add memory
proportional to the module per adapted task. This does not change optimizer
publication, business targets, architecture, provider or native execution bounds.
