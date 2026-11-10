"""Independent per-anchor NT-Xent formulas and native representation training."""
import copy
import math

import pytest
import torch
from torch.nn import functional as F

from self_supervised.model import SimCLR, SSLPreTrainer


def scalar_reference(a, b, temperature):
    z = torch.cat([a, b]); count = len(a); losses = []
    for anchor in range(2 * count):
        positive = (anchor + count) % (2 * count)
        candidates = torch.stack([torch.dot(z[anchor], z[j]) / temperature
                                  for j in range(2 * count) if j != anchor])
        score = torch.dot(z[anchor], z[positive]) / temperature
        losses.append(torch.logsumexp(candidates, 0) - score)
    return torch.stack(losses).mean()


@pytest.mark.parametrize('batch', [1, 2, 3, 7])
@pytest.mark.parametrize('temperature', [.05, .5, 2.])
def test_native_per_anchor_loss_and_gradient_reference(batch, temperature):
    torch.manual_seed(14)
    a = F.normalize(torch.randn(batch, 4, dtype=torch.float64), dim=1).requires_grad_()
    b = F.normalize(torch.randn(batch, 4, dtype=torch.float64), dim=1).requires_grad_()
    aa = a.detach().clone().requires_grad_(); bb = b.detach().clone().requires_grad_()
    model = SimCLR(4, 8, 4); model.temperature = temperature
    actual = model.contrastive_loss(a, b); expected = scalar_reference(aa, bb, temperature)
    torch.testing.assert_close(actual, expected, rtol=1e-10, atol=1e-10)
    actual.backward(); expected.backward()
    torch.testing.assert_close(a.grad, aa.grad, rtol=1e-9, atol=1e-9)
    torch.testing.assert_close(b.grad, bb.grad, rtol=1e-9, atol=1e-9)
    if batch == 1:
        assert actual.item() == 0
        assert torch.equal(a.grad, torch.zeros_like(a))


@pytest.mark.parametrize('dtype', [torch.float32, torch.float16, torch.bfloat16])
def test_native_small_temperature_lower_precision_is_finite(dtype):
    a = torch.eye(3, dtype=dtype, requires_grad=True)
    b = torch.roll(torch.eye(3, dtype=dtype), 1, 0).requires_grad_()
    model = SimCLR(3, 6, 3); model.temperature = .0001
    loss = model.contrastive_loss(a, b)
    assert math.isfinite(loss.item())
    loss.backward()
    assert torch.isfinite(a.grad).all() and torch.isfinite(b.grad).all()


def test_pair_permutation_and_view_swap_are_invariant():
    torch.manual_seed(10); a = F.normalize(torch.randn(5, 4), dim=1); b = F.normalize(torch.randn(5, 4), dim=1)
    model = SimCLR(4, 8, 4); order = torch.tensor([4, 2, 0, 3, 1])
    loss = model.contrastive_loss(a, b)
    torch.testing.assert_close(loss, model.contrastive_loss(b, a))
    torch.testing.assert_close(loss, model.contrastive_loss(a[order], b[order]))


@pytest.mark.parametrize('bad', ['empty', 'rank', 'width', 'rows', 'dtype', 'integer', 'nan', 'inf',
                                  'temperature_zero', 'temperature_negative', 'temperature_nan',
                                  'temperature_inf', 'temperature_bool', 'overflow'])
def test_invalid_paired_objective_rejected_before_parameter_mutation(bad):
    model = SimCLR(4, 8, 4); prior = copy.deepcopy(model.state_dict())
    a = torch.ones(2, 4); b = a.clone()
    if bad == 'empty': a = a[:0]; b = b[:0]
    elif bad == 'rank': a = a.flatten(); b = b.flatten()
    elif bad == 'width': b = b[:, :2]
    elif bad == 'rows': b = b[:1]
    elif bad == 'dtype': b = b.double()
    elif bad == 'integer': a = a.long(); b = b.long()
    elif bad == 'nan': b[0, 0] = float('nan')
    elif bad == 'inf': a[0, 0] = float('inf')
    elif bad == 'overflow': a.fill_(1e30); b.fill_(1e30)
    else:
        model.temperature = {'temperature_zero': 0, 'temperature_negative': -1,
                             'temperature_nan': float('nan'), 'temperature_inf': float('inf'),
                             'temperature_bool': True}[bad]
    with pytest.raises(ValueError):
        model.contrastive_loss(a, b)
    for key, value in prior.items(): torch.testing.assert_close(value, model.state_dict()[key])


def test_native_encoder_projection_gradients_and_optimizer_reference():
    torch.manual_seed(45); model = SimCLR(4, 8, 3); other = copy.deepcopy(model)
    x = torch.randn(5, 4); y = x + torch.randn_like(x) * .1
    _, a = model(x); _, b = model(y); actual = model.contrastive_loss(a, b)
    _, aa = other(x); _, bb = other(y); expected = scalar_reference(aa, bb, model.temperature)
    actual.backward(); expected.backward()
    first = torch.optim.AdamW(model.parameters(), lr=.01); second = torch.optim.AdamW(other.parameters(), lr=.01)
    for p, q in zip(model.parameters(), other.parameters()):
        torch.testing.assert_close(p.grad, q.grad, rtol=1e-4, atol=1e-6)
    first.step(); second.step()
    for p, q in zip(model.parameters(), other.parameters()): torch.testing.assert_close(p, q, rtol=1e-4, atol=1e-6)


def test_existing_native_pretraining_singleton_tail_and_checkpoint(tmp_path):
    model = SimCLR(4, 8, 3); keys = list(model.state_dict())
    trainer = SSLPreTrainer(model, device='cpu')
    result = trainer.pretrain_simclr(torch.randn(5, 4), epochs=2, batch_size=2)
    assert all(math.isfinite(loss) for loss in result['losses'])
    assert trainer.optimizer.state
    path = tmp_path / 'simclr.pth'; torch.save(model.state_dict(), path)
    restored = SimCLR(4, 8, 3); restored.load_state_dict(torch.load(path, weights_only=True))
    assert list(restored.state_dict()) == keys
    x = torch.randn(2, 4)
    for actual, expected in zip(model(x), restored(x)): torch.testing.assert_close(actual, expected)
