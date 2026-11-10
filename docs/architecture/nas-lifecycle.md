# Native NAS search lifecycle

A `NASSearcher` owns each complete random, evolutionary or reinforcement cycle with a process-local reentrant native lock. Evaluator execution, candidate transitions, result preparation and completed publication all belong to the native call. Cancellation of an HTTP/async waiter does not cancel that native work or release its ownership. Competing calls on the same instance wait; they cannot publish a mixed completed state.

Winner and history copies are prepared privately. A separate short state lock publishes the complete architecture/score/history generation. `snapshot_history()` captures an independently owned view of the latest completed run, including its last20 entries, total trial count and winner. It remains readable while another native cycle waits in an evaluator or candidate supplier. Failed search leaves prior completed state intact. Results and snapshots cannot mutate published records through aliases.

The mounted FastAPI `/nas/search` and `/nas/build-model` handlers are synchronous worker endpoints. Native search and Torch module allocation run in FastAPI's worker pool rather than blocking the ASGI event loop. `/nas/history` uses the completed snapshot API. Direct legacy attribute reads are compatibility views, not an atomic multi-field read API; external mutation of the searcher/configuration and evaluator callbacks that wait for a competing search on the same instance are unsupported.

This is one-process ownership, not a distributed scheduler, fair queue, work limit, cross-process shared state or native interrupt facility. Search results still describe the latest completed run rather than best-ever across runs. The existing Python random stream, genotype/score identity, configured construction policy and RL controller protocol are unchanged. HTTP random/evolutionary scores remain synthetic placeholders. Reinforcement search requires an explicit evaluator; no real accuracy, optimality or hardware performance claim is made. Searcher objects containing native locks should not be serialized/deep-copied as runtime capabilities; use history snapshots for owned state.

## Verification

Native event/barrier tests use real search, Torch controller, FastAPI/httpx ASGI dispatch and worker cancellation. They verify all three cycle methods, prompt warm history reads, private publication preparation, evaluator failure, retained cancellation ownership, snapshot/result mutation and actual native model construction. Existing identity tests retain budget/RNG assertions via a serving-state snapshot instead of copying locks.

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest \
  backend/ml/tests/test_nas_lifecycle.py backend/ml/tests/test_nas_identity.py \
  backend/ml/tests/test_nas_construction_plan.py \
  backend/ml/tests/test_nas_controller_policy.py backend/ml/tests/test_nas.py -q
```

The focused Linux gate verifies both Torch2.8 and the declared2.13 runtime. An existing Starlette/AnyIO deprecated alias warning is unrelated to these changes and is retained explicitly.
