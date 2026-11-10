"""Native masked-loss references and no-observation optimizer admission."""
import copy
import math

import pytest
import torch
from torch.nn import functional as F

from self_supervised.model import MaskedAutoencoder, SSLPreTrainer


def native(ratio=.25, dtype=torch.float32):
    torch.manual_seed(26)
    return MaskedAutoencoder(3, 6, mask_ratio=ratio).to(dtype)


def nested(a, b):
    if isinstance(a, torch.Tensor): torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a: nested(a[k], b[k])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b): nested(x, y)
    else: assert a == b


@pytest.mark.parametrize('ratio', [0., .25, 1.])
@pytest.mark.parametrize('seed', [0, 1, 2, 3])
def test_actual_random_masks_exact_loss_and_parameter_gradient(ratio, seed):
    model = native(ratio, torch.float64); other = copy.deepcopy(model)
    x = torch.randn(2, 2, 3, dtype=torch.float64); before = x.clone()
    torch.manual_seed(seed)
    reconstruction, actual, mask = model(x)
    masked = torch.where(mask.unsqueeze(-1), other.mask_token.expand_as(x), x)
    expected_reconstruction = other.decoder(other.encoder(masked))
    expected = (expected_reconstruction[mask] - x[mask]).square().mean() if mask.any() else expected_reconstruction.flatten()[0] * 0
    torch.testing.assert_close(actual, expected, rtol=1e-10, atol=1e-10)
    torch.testing.assert_close(reconstruction, expected_reconstruction)
    torch.testing.assert_close(x, before, rtol=0, atol=0)
    actual.backward(); expected.backward()
    for a, b in zip(model.parameters(), other.parameters()):
        assert a.grad is not None and torch.isfinite(a.grad).all()
        torch.testing.assert_close(a.grad, b.grad, rtol=1e-9, atol=1e-9)


@pytest.mark.parametrize('ratio', [0., .25])
def test_native_single_token_empty_selection_has_differentiable_zero(ratio):
    model = native(ratio)
    # Native generator seed0 starts with0.496; default0.25 selects no token.
    torch.manual_seed(0)
    _, loss, mask = model(torch.ones(1, 1, 3))
    assert not mask.any() and loss.item() == 0 and loss.requires_grad
    loss.backward()
    assert all(p.grad is not None and torch.equal(p.grad, torch.zeros_like(p)) for p in model.parameters())


@pytest.mark.parametrize('dtype', [torch.float16, torch.bfloat16])
def test_native_lower_precision_masked_backward_uses_finite_loss(dtype):
    model = native(1., dtype); x = torch.ones(2, 2, 3, dtype=dtype)
    _, loss, _ = model(x); assert math.isfinite(loss.item())
    loss.backward(); assert all(torch.isfinite(p.grad).all() for p in model.parameters())


def test_no_observation_preserves_already_trained_native_adamw_moments_and_weights():
    model = native(1.); trainer = SSLPreTrainer(model, device='cpu')
    data = torch.randn(5, 2, 3)
    trainer.pretrain_mae(data, epochs=1, batch_size=2)
    assert trainer.optimizer.state
    model.mask_ratio = 0
    prior = copy.deepcopy((model.state_dict(), trainer.optimizer.state_dict()))
    history = trainer.pretrain_mae(data, epochs=3, batch_size=2)
    assert history == {'losses': [0., 0., 0.], 'final_loss': 0., 'method': 'mae', 'observed_batches': 0, 'skipped_batches': 9}
    nested(prior, (model.state_dict(), trainer.optimizer.state_dict()))


@pytest.mark.parametrize('bad', ['empty', 'tokens', 'width', 'rank', 'nan_late', 'integer', 'dtype',
                                  'ratio_negative', 'ratio_over', 'ratio_nan', 'ratio_bool',
                                  'epochs_zero', 'epochs_bool', 'batch_zero', 'batch_float'])
def test_complete_invalid_dataset_rejected_before_native_optimizer_updates(bad):
    model = native(1.); trainer = SSLPreTrainer(model, device='cpu')
    data = torch.ones(5, 2, 3); trainer.pretrain_mae(data, epochs=1, batch_size=2)
    kwargs = {'epochs': 1, 'batch_size': 2}
    if bad == 'empty': data = data[:0]
    elif bad == 'tokens': data = data[:, :0]
    elif bad == 'width': data = data[..., :2]
    elif bad == 'rank': data = data[:, 0]
    elif bad == 'nan_late': data[-1, 0, 0] = float('nan')
    elif bad == 'integer': data = data.long()
    elif bad == 'dtype': data = data.double()
    elif bad == 'ratio_negative': model.mask_ratio = -.1
    elif bad == 'ratio_over': model.mask_ratio = 1.1
    elif bad == 'ratio_nan': model.mask_ratio = float('nan')
    elif bad == 'ratio_bool': model.mask_ratio = True
    elif bad == 'epochs_zero': kwargs['epochs'] = 0
    elif bad == 'epochs_bool': kwargs['epochs'] = True
    elif bad == 'batch_zero': kwargs['batch_size'] = 0
    elif bad == 'batch_float': kwargs['batch_size'] = 1.5
    prior = copy.deepcopy((model.state_dict(), trainer.optimizer.state_dict()))
    with pytest.raises(ValueError): trainer.pretrain_mae(data, **kwargs)
    nested(prior, (model.state_dict(), trainer.optimizer.state_dict()))


def test_native_full_mask_pretraining_and_checkpoint_compatibility(tmp_path):
    model = native(1.); keys = list(model.state_dict()); trainer = SSLPreTrainer(model, device='cpu')
    data = torch.randn(5, 2, 3)
    result = trainer.pretrain_mae(data, epochs=2, batch_size=2)
    assert all(math.isfinite(v) for v in result['losses']) and trainer.optimizer.state
    assert result['observed_batches'] == 6 and result['skipped_batches'] == 0
    path = tmp_path / 'mae.pth'; trainer.save(path)
    other_model = native(1.); other = SSLPreTrainer(other_model, device='cpu'); other.load(path)
    assert list(other_model.state_dict()) == keys
    nested((model.state_dict(), trainer.optimizer.state_dict()), (other_model.state_dict(), other.optimizer.state_dict()))
    torch.testing.assert_close(model.reconstruct(data), other_model.reconstruct(data))
