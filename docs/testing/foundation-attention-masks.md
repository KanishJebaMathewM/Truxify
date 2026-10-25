# Foundation attention keep-mask contract

The public foundation mask has shape `[batch, sequence]`, containing binary keep values with at least one token in every sample. It becomes `[batch, 1, 1, keys]` for attention and remains two-dimensional for pooled outputs. Standalone MultiHeadAttention additionally accepts `[batch, queries, keys]` pairwise masks and rank-four masks broadcastable to `[batch, heads, queries, keys]`. Rank-two masks always mean token masks, never an ambiguous square causal mask. Masks must share the input device.

Masked keys receive zero attention. Empty attention query rows use finite scores for softmax then explicitly zero attention, preventing NaN backward derivatives; output projection contribution is zero when every head is empty for that query. Fully padded foundation samples are rejected before embeddings to prevent zero-denominator pooling. Parameters, checkpoints and unmasked behavior remain compatible.

Run:

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q backend/ml/tests/test_foundation_attention_masks.py backend/ml/tests/test_foundation.py backend/ml/tests/test_foundation_data.py backend/ml/tests/test_foundation_validation.py
python -m ruff check backend/ml/foundation/model.py backend/ml/tests/test_foundation_attention_masks.py --select E9,F63,F7,F82
```

47 local native tests/12 subtests pass, including31new controls; unchanged current-main source fails23/passes8 of the new tests. Independent native PyTorch scaled_dot_product_attention references verify outputs and parameter/input derivatives under token, pairwise and broadcast masks, unequal query/key lengths and batch sizes1/2/3. CPU float32/float16/bfloat16 empty-row backward stays finite. Classification/regression/generation public outputs are invariant to padded token substitutions; native Adam and unused embedding gradients verify masked keys cannot train the pooled objective. Existing data/validation tests pass.

Reference: https://docs.pytorch.org/docs/stable/generated/torch.nn.functional.scaled_dot_product_attention.html

No generation feature, production fit, provider or empirical model-quality claim. Focused Linux gate runs actual CPU Torch; unrelated backend CI is not claimed.
