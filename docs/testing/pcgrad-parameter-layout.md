# Native PCGrad full parameter coordinates

Each weighted task loss differentiates over one ordered list of all trainable
parameters. Unused private heads occupy zero coordinates; compacting only
non-None gradients would shift parameter identities or change vector widths.
The resolved aggregate is reconstructed against exactly that same layout.
Entirely disconnected parameters retain grad=None, so Adam skips their state.

Projection uses the current projected task vector against each original other
task gradient. The repository's deterministic iteration order is preserved;
inputs are not mutated. Zero task weights give zero per-task derivatives, not a
guarantee that already-existing optimizer momentum freezes that task forever.
Non-PCGrad weighted backward is unchanged.

Algorithm reference: [Gradient Surgery for Multi-Task Learning](https://arxiv.org/abs/2001.06782),
Algorithm1. The implementation retains the repository's deterministic order
rather than claiming the paper's randomized ordering or model-quality results.

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q \
  backend/ml/tests/test_pcgrad_parameter_layout.py backend/ml/tests/test_mtl.py \
  -k 'not test_mtl_init'
python -m ruff check backend/ml/mtl/model.py \
  backend/ml/tests/test_pcgrad_parameter_layout.py --select E9,F63,F7,F82
```

20 local native tests pass, including three existing PCGrad controls. The
existing init assertion calls MultiTaskModel without its required tasks argument
and is explicitly excluded; no API default/topology change is included.
New tests compare actual shared/private/frozen parameter derivatives against
independent full-coordinate orthogonal projections, exercise real Adam updates,
zero-weight task derivatives and a three-task sequential counterexample.

Classification logits, target dictionary ordering, reward/task business policy,
architecture/checkpoints/providers and full optional-module/backend CI are
outside this scoped gradient correction.
