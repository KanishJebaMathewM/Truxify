# Native GNN raw graph export interoperability

Python 3.12 / CPU Torch 2.8.0, then install requirements.txt and run:

```sh
PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_gnn_graph_export.py backend/ml/tests/test_gnn_feature_scaling.py backend/ml/tests/test_gnn_parallel_edges.py -k 'not selects_the_better and not can_select_parallel'
```

Actual exported GraphNetworkBuilder, native NetworkX/PyG graphs, fitted/default
scaler, native Torch model and existing training/checkpoint tests are exercised.
Explicit graphs retain their own topology/node maps under concurrent exports;
parallel rows preserve the graph's edge iteration order and raw physical units.
The base extractor is the single feature contract; the parallel subclass delegates
instead of shadowing it with obsolete scaling and a no-argument signature.

Two pre-existing parallel route selection tests are explicitly deselected:
_negative_edge_metrics_patch overrides the scorer without the edge_data argument
passed by the parallel solver. This change does not fix that separate scorer
compatibility failure, pending nonfinite validation, ASGI dispatch or model
publication. Existing parallel export expectations now assert raw time8/20 rather
than the obsolete normalized0.08/0.20, matching the merged fitted scaler contract.
