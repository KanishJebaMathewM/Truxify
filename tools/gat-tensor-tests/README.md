# Native GAT tensor contract

Python3.12 / CPU Torch2.8.0 then install requirements.txt and run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_gat_tensor_contract.py backend/ml/tests/test_gat_temporal.py
```

Actual Torch/PyG GATConv, LSTM and Adam backpropagation are exercised. Builder2-D
inputs become a single graph/single timestep;4-D inputs preserve batch, node and
time axes. Every batch graph gets offset topology in each timestep. Predictions
use the final LSTM state, yielding one horizon per node. Training/validation
adapt2-D targets only for a single graph and reject mismatches instead of
broadcasting loss. Native batch predictions match independent graph predictions;
perturbing one batch sample does not affect the others. Hooks verify correctly
offset native spatial edges at every timestep; gradients reach earlier steps.

The existing temporal influence fixture uses valid head dimensions, evaluation
mode and deterministic positive weights so dead ReLUs/dropout cannot invalidate
or fake its neighbor assertion. A real local ASGI `/gat/predict` uses the actual
endpoint, native builder and a small native model.

No graph-ID remapping, provider calls, synthetic target policy, asynchronous
executor ownership, checkpoint lifetime or model publication change. The stale
legacy `tests/test_gat.py` import of nonexistent GATModel remains unrelated and
is not included in this focused gate. Pydantic deprecation warnings remain.
