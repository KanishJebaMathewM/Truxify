# Convex heterogeneous meta-path selection

The standalone NumPy component computes `Q1 @ Q2`, where each Q is a convex
combination of relation adjacency matrices. Its two parameter rows are logits;
stable softmax over relation types produces the coefficients. The primary
[GTN paper](https://proceedings.neurips.cc/paper/9367-graph-transformer-networks.pdf)
describes convex soft edge selection. This repair implements that existing
operator's semantics; it does not provide the complete paper architecture.

For source s and destination d, the result equals the sum over ordered relation
pairs (a,b) and intermediate nodes k of
`alpha[a] * beta[b] * A[a][s,k] * A[b][k,d]`.
An independent test oracle explicitly enumerates these walks across 80 seeded
small graphs. The implementation mixes the graphs first, requiring one dense
matrix product instead of one product per relation pair.

## Admission and numeric behavior

All graphs must be finite nonnegative square matrices with the same nonempty
node basis. Integer and boolean incidence matrices are valid and copied into
float64. Strings, complex/nonfinite values, ragged shapes and negative weights
are rejected. Selection logits must be a finite `(2, num_edge_types)` matrix.
Adding a common logit shift does not change the selected graph, and identical
relations yield the same product for any relation count (within floating-point
precision). Each row has at least one max-shifted exponential equal to one.
For opposite extreme finite logits a difference can reach negative infinity;
its exponential is exactly zero, retaining the intended limiting selection.

Weighted graphs are accumulated directly. Scaling all relations by an unrelated
maximum could erase a selected tiny graph beside an unselected huge one; that
failure is covered by a regression. Unrepresentable mixture/product arithmetic
raises OverflowError rather than emitting a nonfinite or partial graph.
Source and destination indices must be in-range nonnegative integers; boolean
and fractional indices reject. The existing sigmoid and four-decimal link score
are retained. This score is not a trained or calibrated matching probability.

Inputs and logits are copied and never modified. The copies do not synchronize
concurrent external mutation during copying. The operator remains dense with
O(E N^2 + N^3) arithmetic and O(E N^2) memory; sparse large-graph scaling is outside
this repair. No provider, serving integration or production vehicle action occurs.

## Migration and verification

Callers previously storing actual mixture coefficients in the misleading
`edge_selection_weights` field must convert positive coefficients to log values
before use. Exact zero mass is approximated with a sufficiently negative finite
logit; nonfinite model parameters reject. Default four-relation equal logits
retain their old uniform mixture. Other cardinalities and unequal logits now
follow normalized selection, changing legacy scores intentionally.

The component has no training loop, degree-normalized graph convolution,
learned node embedding or mounted serving caller beyond its tests. The historical
embedding_dim field remains metadata and is validated. Original tests still pass.
The Linux gate copies the three exact component/test source files into an isolated
collection directory to avoid unrelated gnn.__init__ Torch/PyG startup; no source
is rewritten or mocked. It verifies this component, not the complete GNN package.
Six unchanged-main controls fail on casting, logit-shift and directed selection.

Run from repository root:

```sh
PYTHONPATH=backend/ml/gnn python -m pytest backend/ml/gnn/test_gtn.py backend/ml/gnn/test_gtn_metapath.py -q
python -m ruff check backend/ml/gnn/gtn_logistics.py backend/ml/gnn/test_gtn.py backend/ml/gnn/test_gtn_metapath.py
```
