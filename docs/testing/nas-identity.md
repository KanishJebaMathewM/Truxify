# Native NAS genotype and score identity

The random/evolutionary engine now owns admitted genotype snapshots at candidate, evaluator, elite, winner, history and result boundaries. Neighbors each change one gene and cannot mutate the parent/other candidates. Model metadata is detached from caller lists. Search-space candidates require aligned nonempty fields, known operations/activations, configured layer range and filter bounds/multiples of eight; standalone model construction retains positive filter widths and arbitrary positive depth.

Each completed search publishes a fresh per-run history of exactly the evaluated candidates and their returned finite scores; evolutionary entries add generation/candidate indices. Internal winner, internal history and returned winner/history are independently owned. Failed budget/evaluator admission does not publish partial state. Evaluator copies may be modified or retained, but the recorded candidate remains the original input; evaluators are responsible for computing a meaningful score for that input. A scorer is not a sandbox and unrelated global side effects are outside this protocol.

Singleton/odd populations retain at least one elite. Mutation honors the configured layer minimum/maximum. No unused final offspring are generated. Ties preserve first evaluated winner and stable elite order. This changes previous RNG consumption/history accumulation; reproducibility is within the new implementation, not bit-identical old traces. Search scores still default to the existing synthetic uniform placeholder when no evaluator is supplied; this is not an accuracy benchmark or a completed RL controller.

## Focused verification

Use Python3.12/native CPU Torch2.8, NumPy1.26.4, pytest9.0.3, Ruff0.16.9, FastAPI0.116.1 and httpx0.28.1:

```sh
PYTHONPATH=backend/ml:backend/ml/nas OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_nas_identity.py backend/ml/nas/test_nas.py::TestNASPruner::test_channel_pruning
python -m ruff check backend/ml/nas/model.py backend/ml/tests/test_nas_identity.py --select E9,F63,F7,F82
```

The26 new tests cover single-gene distances/independence, adversarial callback/result aliases, exact score provenance through population1/3/5,600 upper/lower-bound mutations, budget/RNG state, failed-run publication, real Torch Adam/backward and actual ASGI singleton search/history. Unchanged main938da147 fails25/passes1. The existing channel-pruning control remains passing. The separate legacy Pareto assertion fails unchanged (reported accuracy_drop_pct9.5 versus expected<1); a broader combined run has27PASS/1FAIL, verified against unchanged main, and that independent pruning claim is explicitly excluded from this focused gate. The local ASGI control emits an existing Starlette/AnyIO deprecation warning.

No changes to placeholder RL updates, zero-operator semantics, simplified FLOPs, pruning, exporter, model accuracy or distributed/concurrent scheduling are claimed. Returned state remains ordinary dictionaries for existing JSON consumers. The route's existing generic500 treatment of invalid search requests remains outside this repair.
