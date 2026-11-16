# MoCo momentum-key dictionary protocol

Keys start as exact query-encoder copies and are frozen. Training computes the EMA before encoding keys, using no-grad operations; only query parameters receive objective derivatives and optimizer updates. Evaluation uses the existing dictionary without advancing EMA or queue.

Queue insertion admits any positive row count. It retains at most the newest capacity rows, writes them in circular order and advances the pointer by the total admitted count. Direct enqueue validates finite matching shape/dtype/device and pointer before writes. Paired forward validates complete nonempty encoder-compatible finite views, pointer and temperature before lifecycle mutation. This is not a transactional rollback protocol for corrupt model parameters or arbitrary external writers.

Registered model keys and optimizer parameter ordering stay compatible with saved models. Legacy checkpoints with key optimizer moments may retain those unused moments; frozen key parameters no longer receive gradients. Existing query/key parameter objects stay registered and EMA updates in place.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_moco_key_queue_protocol.py backend/ml/tests/test_self_supervised.py
python -m ruff check backend/ml/self_supervised/model.py backend/ml/tests/test_moco_key_queue_protocol.py --select E9,F63,F7,F82
```

36local native tests pass; unchangedmain fails31/passes4 new tests. Native closed-form EMA0/0.75/1 references verify exact pre-encoding key/loss/query derivatives; actual Adam leaves keys unchanged. A sequential row-write queue oracle verifies capacities1/3/5, wraparound and oversized batches. Eval is repeatable without state mutation; native model+optimizer checkpoint continuation matches the next wrapped batch exactly. Temporary actual-source integration with separate SimCLR PR17177 passes68 tests.

Algorithm reference: original MoCo paper https://arxiv.org/abs/1911.05722, momentum encoder and queue dictionary. No distributed/all-gather protocol, production fit, provider, new architecture or empirical quality claim.
