# SimCLR paired NT-Xent objective

Each anchor uses its paired view as exactly one positive among all other representations; only self similarity is excluded. The previous construction concatenated the positive with non-self similarities already containing it, corrupting the denominator and gradient. A batch containing one positive pair now has zero loss/gradient instead of artificial log(2).

The method consumes normalized embeddings produced by SimCLR.forward and preserves their row pairing. It validates identical nonempty floating tensor shapes, dtype/device, finite embeddings and finite positive numeric temperature. Float16/bfloat16 similarities accumulate in float32. Unrepresentable logits raise ValueError. Encoder/projection parameter topology and checkpoint keys are unchanged; existing augmentation semantics remain.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_simclr_pair_objective.py backend/ml/tests/test_self_supervised.py
python -m ruff check backend/ml/self_supervised/model.py backend/ml/tests/test_simclr_pair_objective.py --select E9,F63,F7,F82
```

33 local native tests pass (32new plus existing control); unchanged current-main source fails27/passes5 new tests. Independent per-anchor logsumexp formulas validate numerical losses and embedding derivatives for batch1/2/3/7 and temperatures0.05/0.5/2. Native float32/float16/bfloat16 small-temperature controls stay finite. Swapping views/permuting both paired batches preserves the loss. Actual encoder/projection gradients and AdamW updates match the scalar objective. Existing pretraining with singleton tails and checkpoint roundtrip pass.

Algorithm reference: original SimCLR paper https://arxiv.org/abs/2002.05709 (Equation1, denominator excludes self, includes the positive once).

No production fit, fraud threshold/centroid adjustment or empirical model-quality claim. Focused Linux CPU gate runs native Torch; no broad backend-CI claim.
