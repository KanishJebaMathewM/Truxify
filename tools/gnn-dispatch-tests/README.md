# Native GNN ASGI dispatch regression

Run with Python 3.12 and CPU Torch 2.8.0:

```sh
python -m pip install torch==2.8.0 --index-url https://download.pytorch.org/whl/cpu
python -m pip install -r tools/gnn-dispatch-tests/requirements.txt
PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_gnn_asgi_dispatch.py backend/ml/tests/test_gnn_event_loop_isolation.py
```

These tests import the real routes registry and compatibility module, mount
FastAPI routes, and send local ASGI JSON requests. They preserve body schemas,
validation, dependencies, auth, HTTP 503, and native error redaction. Native
NetworkX graph construction and the actual bounded thread executor are tested;
blocked native graph work leaves health requests responsive and consumes shared
capacity. Optimizer boundaries use deterministic injected providers so this
suite does not claim unrelated GNN solver or graph-to-PyG signature bugs pass.

The previous endpoint monkeypatch removed annotations/dependencies and called a
missing helper. Typed registered handlers now own offloading; the old module is
an import-compatible no-op. This change does not replace executor admission,
cancellation ownership, model training, checkpoint lifetimes or solver math.
Existing `.dict()` deprecation warnings remain visible.
