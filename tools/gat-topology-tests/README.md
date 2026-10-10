# Native GAT request topology

Python3.12 / CPU Torch2.8.0, install requirements.txt then:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_gat_request_topology.py
```

Actual NetworkX/PyG/GATConv and local FastAPI/HTTPX ASGI requests verify public
ID-to-row mapping, undirected edges, fresh graphs, explicit captured snapshots,
concurrent exports, empty/isolated shapes and atomic publication after complete
construction. Public IDs remain unchanged in the NetworkX graph. Feature units
retain the existing GAT policy. Duplicate IDs and undeclared edge endpoints are
rejected before native work as body-validation422 responses.

Build/predict/train operations each construct a request builder and export their
captured graph. Empty build summaries report disconnected instead of calling
NetworkX connectivity on an empty graph. Failed builds retain the prior graph.

Full SpatialTemporalGAT/model trainer tensor execution remains a separate defect
addressed by17106; this independent gate tests actual native GATConv consumption
and topology dispatch. No model architecture, targets, provider, checkpoint or
executor lifetime changes are included. Pydantic deprecation warnings remain.
