"""Native SDPA references and foundation padding/gradient contracts."""
import copy

import pytest
import torch
from torch.nn import functional as F

from foundation.model import LogisticsFoundationModel, MultiHeadAttention


def reference(layer, q, k, v, keep=None):
    batch, queries, _ = q.shape
    shape = lambda z: z.reshape(batch, -1, layer.num_heads, layer.d_k).transpose(1, 2)
    out = F.scaled_dot_product_attention(shape(layer.w_q(q)), shape(layer.w_k(k)),
                                         shape(layer.w_v(v)), attn_mask=keep, dropout_p=0)
    out = layer.w_o(out.transpose(1, 2).reshape(batch, queries, layer.d_model))
    if keep is not None:
        full = torch.broadcast_to(keep, (batch, layer.num_heads, queries, k.shape[1]))
        out = out.masked_fill((~full.any(-1)).all(1).unsqueeze(-1), 0)
    return out


@pytest.mark.parametrize('batch,queries,keys', [(1, 3, 3), (2, 3, 3), (3, 3, 3), (2, 2, 5)])
@pytest.mark.parametrize('kind', ['token', 'pairwise', 'broadcast'])
def test_native_sdpa_output_and_backward_reference(batch, queries, keys, kind):
    torch.manual_seed(6)
    layer = MultiHeadAttention(8, 2, dropout=0)
    other = copy.deepcopy(layer)
    q = torch.randn(batch, queries, 8, requires_grad=True)
    k = torch.randn(batch, keys, 8, requires_grad=True)
    v = torch.randn(batch, keys, 8, requires_grad=True)
    qq, kk, vv = [x.detach().clone().requires_grad_() for x in (q, k, v)]
    if kind == 'token':
        mask = torch.ones(batch, keys, dtype=torch.bool); mask[:, -1] = False
        keep = mask[:, None, None, :]
    elif kind == 'pairwise':
        mask = torch.ones(batch, queries, keys, dtype=torch.bool); mask[:, -1, :] = False
        mask[:, 0, -1] = False; keep = mask[:, None, :, :]
    else:
        mask = torch.ones(1, 1, queries, keys, dtype=torch.bool); mask[..., -1] = False
        keep = mask
    actual = layer(q, k, v, mask)
    expected = reference(other, qq, kk, vv, keep)
    torch.testing.assert_close(actual, expected, rtol=2e-5, atol=2e-6)
    actual.square().sum().backward(); expected.square().sum().backward()
    for a, b in zip((q, k, v), (qq, kk, vv)):
        torch.testing.assert_close(a.grad, b.grad, rtol=3e-5, atol=3e-6)
    for a, b in zip(layer.parameters(), other.parameters()):
        torch.testing.assert_close(a.grad, b.grad, rtol=3e-5, atol=3e-6)


@pytest.mark.parametrize('dtype', [torch.float32, torch.float16, torch.bfloat16])
def test_fully_masked_rows_are_zero_with_finite_lower_precision_backward(dtype):
    layer = MultiHeadAttention(8, 2, dropout=0).to(dtype)
    x = torch.randn(2, 3, 8, dtype=dtype, requires_grad=True)
    out = layer(x, x, x, torch.zeros(2, 3, dtype=torch.bool))
    assert torch.equal(out, torch.zeros_like(out))
    out.sum().backward()
    assert torch.isfinite(x.grad).all()
    assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in layer.parameters())


def small():
    torch.manual_seed(7)
    return LogisticsFoundationModel(vocab_size=20, d_model=8, num_heads=2,
                                     num_layers=2, d_ff=16, max_len=8, dropout=0)


@pytest.mark.parametrize('task', ['classification', 'regression', 'generation'])
def test_native_batched_padding_invariance_optimizer_and_unused_token_gradient(task):
    model = small()
    ids = torch.tensor([[1, 2, 3], [4, 5, 6]])
    mask = torch.tensor([[1, 1, 0], [1, 0, 0]])
    changed = torch.tensor([[1, 2, 15], [4, 16, 17]])
    a = model(ids, mask, task=task); b = model(changed, mask, task=task)
    torch.testing.assert_close(a['output'], b['output'], rtol=0, atol=0)
    torch.testing.assert_close(a['hidden'], b['hidden'], rtol=0, atol=0)
    optimizer = torch.optim.Adam(model.parameters(), lr=.01)
    before = model.token_embedding.weight.detach().clone()
    b['output'].square().sum().backward()
    assert torch.equal(model.token_embedding.weight.grad[[15, 16, 17]], torch.zeros(3, 8))
    assert all(torch.isfinite(p.grad).all() for p in model.parameters() if p.grad is not None)
    optimizer.step()
    torch.testing.assert_close(model.token_embedding.weight[[15, 16, 17]], before[[15, 16, 17]], rtol=0, atol=0)
    assert optimizer.state


@pytest.mark.parametrize('mask', [torch.zeros(2, 3), torch.tensor([[1, 1, 1], [0, 0, 0]]),
                                  torch.ones(3, 2), torch.ones(2, 1, 3),
                                  torch.full((2, 3), .5), torch.full((2, 3), float('nan'))])
def test_foundation_rejects_invalid_pooling_mask_before_embeddings(mask):
    model = small(); calls = []
    hook = model.token_embedding.register_forward_hook(lambda *_: calls.append(1))
    try:
        with pytest.raises(ValueError, match='mask'):
            model(torch.ones(2, 3, dtype=torch.long), mask)
    finally:
        hook.remove()
    assert not calls


@pytest.mark.parametrize('mask', [torch.ones(3), torch.ones(2, 2), torch.ones(2, 4, 3),
                                  torch.ones(2, 3, 4, 3), torch.ones(1, 1, 1, 1, 3),
                                  torch.full((2, 3), float('inf'))])
def test_standalone_attention_rejects_invalid_shapes_and_values(mask):
    layer = MultiHeadAttention(8, 2, dropout=0); x = torch.randn(2, 3, 8)
    with pytest.raises(ValueError, match='mask'):
        layer(x, x, x, mask)


def test_unmasked_sdpa_and_checkpoint_roundtrip_stay_compatible(tmp_path):
    layer = MultiHeadAttention(8, 2, dropout=0); x = torch.randn(2, 3, 8)
    torch.testing.assert_close(layer(x, x, x), reference(layer, x, x, x), rtol=2e-5, atol=2e-6)
    model = small(); ids = torch.tensor([[1, 2, 3]])
    path = tmp_path / 'model.pth'; torch.save(model.state_dict(), path)
    restored = small(); restored.load_state_dict(torch.load(path, weights_only=True))
    assert model.state_dict().keys() == restored.state_dict().keys()
    torch.testing.assert_close(model(ids)['output'], restored(ids)['output'], rtol=0, atol=0)
    torch.testing.assert_close(model(ids, torch.ones_like(ids))['output'], model(ids)['output'])
