"""Native Torch controls for example/context ownership, not mock loaders."""
import copy

import pytest
import torch
from torch.utils.data import DataLoader, TensorDataset

from diffusion.model import DiffusionRouteModel
from diffusion.trainer import DiffusionTrainer


def trainer():
    model = DiffusionRouteModel(input_dim=4, hidden_dim=16, num_layers=1,
                               num_heads=2, num_timesteps=4, cond_dim=2)
    return DiffusionTrainer(model, device="cpu", batch_size=2)


def rows(n=5, offset=0):
    ids = torch.arange(offset, offset+n, dtype=torch.float32)
    data = ids[:, None, None].expand(-1, 3, 4).clone()
    cond = torch.stack([ids, ids+100], dim=-1)
    return data, cond


def test_native_tensor_dataset_training_updates_optimizer():
    t = trainer()
    before = copy.deepcopy(t.model.state_dict())
    result = t.train(torch.randn(5, 3, 4), epochs=2)
    assert len(result['train_losses']) == 2
    assert all(torch.isfinite(torch.tensor(result['train_losses'])))
    assert t.optimizer.state
    assert any(not torch.equal(value, t.model.state_dict()[key])
               for key, value in before.items())


def test_real_conditional_forward_updates_registered_projection():
    t = trainer()
    data, cond = rows()
    prior = t.model.cond_proj.weight.detach().clone()
    result = t.train(data, epochs=2, condition_data=cond)
    assert torch.isfinite(torch.tensor(result['final_train_loss']))
    assert not torch.equal(prior, t.model.cond_proj.weight)


def test_joint_shuffle_pairs_every_row_and_tail_across_epochs():
    t = trainer()
    data, cond = rows(7)
    loader = DataLoader(t._dataset(data, cond), batch_size=3, shuffle=True)
    for _ in range(4):
        seen = []
        sizes = []
        for x, c in t._batches(loader):
            torch.testing.assert_close(x[:, :, 0], c[:, :, 0])
            seen += x[:, 0, 0].tolist()
            sizes.append(len(x))
        assert sorted(seen) == list(range(7))
        assert sizes == [3, 3, 1]


def test_train_and_validate_use_disjoint_real_native_context(monkeypatch):
    t = trainer()
    data, cond = rows(5)
    val, val_cond = rows(3, 40)
    seen = []
    source = []
    original_add = t.model.add_noise
    original_denoise = t.model.denoise

    def add(x, times, noise):
        source.append(x[:, 0, 0].detach().clone())
        return original_add(x, times, noise)

    def denoise(x, times):
        ids = x[:, 0, 4]
        torch.testing.assert_close(ids, source[-1])
        seen.append((t.model.training, ids.tolist()))
        return original_denoise(x, times)

    monkeypatch.setattr(t.model, 'add_noise', add)
    monkeypatch.setattr(t.model, 'denoise', denoise)
    t.train(data, epochs=2, val_data=val, condition_data=cond, val_condition_data=val_cond)
    for mode, ids in seen:
        assert all((i < 5) if mode else (40 <= i < 43) for i in ids)
    assert len(t.train_losses) == len(t.val_losses) == 2


@pytest.mark.parametrize('kwargs', [
    {'val_data': torch.ones(3, 3, 4)},
    {'val_data': torch.ones(3, 3, 4), 'val_condition_data': torch.ones(2, 2)},
    {'val_condition_data': torch.ones(3, 2)},
    {'condition_data': torch.ones(4, 2)},
    {'condition_data': torch.ones(5, 2, 2)},
    {'epochs': 0},
])
def test_invalid_full_stream_fails_before_any_update(kwargs):
    t = trainer()
    before = copy.deepcopy(t.model.state_dict())
    args = {'condition_data': torch.ones(5, 2)}
    args.update(kwargs)
    with pytest.raises(ValueError):
        t.train(torch.ones(5, 3, 4), **args)
    assert not t.optimizer.state
    assert t.train_losses == t.val_losses == []
    for key, value in before.items():
        torch.testing.assert_close(value, t.model.state_dict()[key])


@pytest.mark.parametrize('n,batch,shuffle,drop', [(4,2,False,False), (5,3,False,False),
                                               (5,2,True,False), (5,2,False,True)])
def test_legacy_misalignment_or_random_permutation_rejected(n, batch, shuffle, drop):
    t = trainer()
    data, cond = rows()
    loader = DataLoader(TensorDataset(data), batch_size=2)
    other = DataLoader(TensorDataset(cond[:n]), batch_size=batch, shuffle=shuffle, drop_last=drop)
    with pytest.raises(ValueError):
        t.train_epoch(loader, other)
    assert not t.optimizer.state


def test_legacy_ordered_tail_is_paired_and_trains():
    t = trainer()
    data, cond = rows()
    loader = DataLoader(TensorDataset(data), batch_size=2)
    contexts = DataLoader(TensorDataset(cond), batch_size=2)
    assert [len(x) for x, c in t._batches(loader, contexts)] == [2, 2, 1]
    assert torch.isfinite(torch.tensor(t.train_epoch(loader, contexts)))


@pytest.mark.parametrize('joint', [True, False])
def test_native_validation_restores_mode_on_success(joint):
    t = trainer()
    data, cond = rows()
    loader = DataLoader(t._dataset(data, cond) if joint else TensorDataset(data), batch_size=2)
    context = None if joint else DataLoader(TensorDataset(cond), batch_size=2)
    assert torch.isfinite(torch.tensor(t.validate(loader, context, require_condition=True)))
    assert t.model.training
    assert not t.optimizer.state


def test_validation_restores_mode_on_failure():
    t = trainer()
    with pytest.raises(ValueError):
        t.validate(DataLoader(TensorDataset(torch.ones(3,3,4)), batch_size=2), require_condition=True)
    assert t.model.training


@pytest.mark.parametrize('data,cond', [(torch.empty(0,3,4), None),
                                     (torch.ones(3), None),
                                     (torch.ones(3,3,4), torch.ones(3))])
def test_empty_and_unbatched_data_rejected(data, cond):
    with pytest.raises(ValueError):
        trainer()._dataset(data, cond)


def test_per_position_context_preserved():
    t = trainer()
    data = torch.randn(5,3,4)
    cond = torch.randn(5,3,2)
    dataset = t._dataset(data, cond)
    assert dataset.tensors[1] is cond
    assert torch.isfinite(torch.tensor(t.train(data, epochs=1, condition_data=cond)['final_train_loss']))


def test_validation_loss_is_sample_weighted_with_short_tail(monkeypatch):
    t = trainer()
    t.model.eval()
    data = torch.randn(5, 3, 4)
    monkeypatch.setattr(torch, 'randn_like', lambda x: torch.zeros_like(x))
    monkeypatch.setattr(torch, 'randint', lambda low, high, size, **kw:
                        torch.zeros(size, dtype=torch.long, device=kw.get('device')))
    times = torch.zeros(5, dtype=torch.long)
    with torch.no_grad():
        prediction = t.model.denoise(t.model.add_noise(data, times, torch.zeros_like(data)), times)
        expected = prediction.square().mean().item()
    observed = t.validate(DataLoader(TensorDataset(data), batch_size=2))
    assert observed == pytest.approx(expected, rel=1e-6)
    assert not t.model.training
