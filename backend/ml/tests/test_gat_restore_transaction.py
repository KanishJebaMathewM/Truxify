"""Actual Torch model/Adam restore publication, validation and serialization."""
import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import pytest
import torch
from gat.model import GATTrainer, SpatialTemporalGAT
from torch_geometric.data import Data


class NativeModel(torch.nn.Module):
    """Small real Torch network matching trainer output; no mocked optimizer."""
    def __init__(self):
        super().__init__()
        self.linear = torch.nn.Linear(5, 3)

    def forward(self, x, edge_index):
        return self.linear(x).unsqueeze(0)


def trainer(native_gat=False):
    network = SpatialTemporalGAT(in_features=5, hidden_features=16, out_features=8,
                                 num_heads=2, num_layers=2, prediction_horizon=3) if native_gat else NativeModel()
    return GATTrainer(network)


def sample():
    return Data(x=torch.ones(2, 5), edge_index=torch.tensor([[0, 1], [1, 0]]))


def checkpoint(value):
    return copy.deepcopy({'model_state_dict': value.model.state_dict(),
                          'optimizer_state_dict': value.optimizer.state_dict()})


def write(tmp_path, content):
    path = tmp_path / 'local.pth'
    torch.save(content, path)
    return str(path)


def unchanged(value, old_model, old_optimizer, state):
    assert value.model is old_model
    assert value.optimizer is old_optimizer
    for key, tensor in state[0].items():
        torch.testing.assert_close(value.model.state_dict()[key], tensor)
    def equal(actual, expected):
        if isinstance(expected, torch.Tensor):
            torch.testing.assert_close(actual, expected)
        elif isinstance(expected, dict):
            assert actual.keys() == expected.keys()
            for key in expected:
                equal(actual[key], expected[key])
        elif isinstance(expected, (tuple, list)):
            assert len(actual) == len(expected)
            for left, right in zip(actual, expected):
                equal(left, right)
        else:
            assert actual == expected
    equal(value.optimizer.state_dict(), state[1])


@pytest.mark.parametrize('native_gat', [False, True])
def test_failed_optimizer_restore_retains_exact_serving_pair(tmp_path, native_gat):
    value = trainer(native_gat)
    old_model, old_optimizer = value.model, value.optimizer
    state = (copy.deepcopy(value.model.state_dict()), copy.deepcopy(value.optimizer.state_dict()))
    content = checkpoint(value)
    content['model_state_dict'] = {key: tensor + 1 for key, tensor in state[0].items()}
    content['optimizer_state_dict']['param_groups'] = []
    with pytest.raises(ValueError):
        value.load(write(tmp_path, content))
    unchanged(value, old_model, old_optimizer, state)


@pytest.mark.parametrize('native_gat', [False, True])
def test_partial_strict_model_failure_never_modifies_serving_weights(tmp_path, native_gat):
    value = trainer(native_gat)
    old_model, old_optimizer = value.model, value.optimizer
    state = (copy.deepcopy(value.model.state_dict()), copy.deepcopy(value.optimizer.state_dict()))
    content = checkpoint(value)
    content['model_state_dict'] = {key: tensor + 1 for key, tensor in state[0].items()}
    last = next(reversed(content['model_state_dict']))
    content['model_state_dict'][last] = torch.zeros(999)
    with pytest.raises(RuntimeError):
        value.load(write(tmp_path, content))
    unchanged(value, old_model, old_optimizer, state)


@pytest.mark.parametrize('native_gat', [False, True])
def test_successful_restore_publishes_complete_private_owned_pair(tmp_path, native_gat):
    value = trainer(native_gat)
    old_model, old_optimizer = value.model, value.optimizer
    content = checkpoint(value)
    for tensor in content['model_state_dict'].values():
        tensor.add_(1)
    before = copy.deepcopy(old_model.state_dict())
    value.load(write(tmp_path, content))
    assert value.model is not old_model
    assert value.optimizer is not old_optimizer
    assert {p for g in value.optimizer.param_groups for p in g['params']} == set(value.model.parameters())
    assert not set(old_model.parameters()) & set(value.model.parameters())
    for key in before:
        torch.testing.assert_close(old_model.state_dict()[key], before[key])
        torch.testing.assert_close(value.model.state_dict()[key], content['model_state_dict'][key])


@pytest.mark.parametrize('bad', ['nan', 'inf'])
def test_nonfinite_model_state_rejected_without_publication(tmp_path, bad):
    value = trainer(True)
    old_model, old_optimizer = value.model, value.optimizer
    state = (copy.deepcopy(value.model.state_dict()), copy.deepcopy(value.optimizer.state_dict()))
    content = checkpoint(value)
    next(iter(content['model_state_dict'].values())).flatten()[0] = float(bad)
    with pytest.raises(ValueError, match='finite'):
        value.load(write(tmp_path, content))
    unchanged(value, old_model, old_optimizer, state)


def trained():
    value = trainer()
    value.train_step(sample(), torch.ones(1, 2, 3))
    return value


@pytest.mark.parametrize('bad', ['shape', 'nan', 'negative_square', 'missing_step', 'negative_step', 'many_steps', 'unknown'])
def test_invalid_native_adam_moments_retain_serving_pair(tmp_path, bad):
    value = trained()
    old_model, old_optimizer = value.model, value.optimizer
    state = (copy.deepcopy(value.model.state_dict()), copy.deepcopy(value.optimizer.state_dict()))
    content = checkpoint(value)
    moment = next(iter(content['optimizer_state_dict']['state'].values()))
    if bad == 'shape':
        moment['exp_avg'] = torch.zeros(999)
    elif bad == 'nan':
        moment['exp_avg_sq'].flatten()[0] = float('nan')
    elif bad == 'negative_square':
        moment['exp_avg_sq'].flatten()[0] = -1
    elif bad == 'missing_step':
        del moment['step']
    elif bad == 'negative_step':
        moment['step'] = torch.tensor(-1.)
    elif bad == 'many_steps':
        moment['step'] = torch.tensor([1., 2.])
    else:
        moment['foreign'] = torch.tensor(1.)
    with pytest.raises((ValueError, KeyError)):
        value.load(write(tmp_path, content))
    unchanged(value, old_model, old_optimizer, state)


@pytest.mark.parametrize('key,bad', [('lr', -1.), ('lr', float('nan')), ('eps', float('inf')), ('weight_decay', -1.)])
def test_invalid_adam_settings_not_published(tmp_path, key, bad):
    value = trained()
    old_model, old_optimizer = value.model, value.optimizer
    state = (copy.deepcopy(value.model.state_dict()), copy.deepcopy(value.optimizer.state_dict()))
    content = checkpoint(value)
    content['optimizer_state_dict']['param_groups'][0][key] = bad
    with pytest.raises(ValueError):
        value.load(write(tmp_path, content))
    unchanged(value, old_model, old_optimizer, state)


def test_restored_real_adam_can_take_the_same_next_native_step(tmp_path):
    source = trained()
    restored = trainer()
    restored.load(write(tmp_path, checkpoint(source)))
    loss1 = source.train_step(sample(), torch.zeros(1, 2, 3))
    loss2 = restored.train_step(sample(), torch.zeros(1, 2, 3))
    assert loss1 == pytest.approx(loss2)
    for key, tensor in source.model.state_dict().items():
        torch.testing.assert_close(restored.model.state_dict()[key], tensor)
    assert all(parameter in set(restored.model.parameters()) for parameter in restored.optimizer.state)


def test_native_candidate_restore_never_exposes_partial_model(tmp_path, monkeypatch):
    value = trainer()
    source = trainer()
    with torch.no_grad():
        for parameter in source.model.parameters():
            parameter.fill_(0.9)
    path = write(tmp_path, checkpoint(source))
    old_model = value.model
    expected_old = old_model(sample().x, sample().edge_index).detach().clone()
    entered, release = threading.Event(), threading.Event()
    original = NativeModel.load_state_dict
    def paused(candidate, *args, **kwargs):
        result = original(candidate, *args, **kwargs)
        entered.set()
        assert release.wait(3)
        return result
    monkeypatch.setattr(NativeModel, 'load_state_dict', paused)
    with ThreadPoolExecutor(max_workers=1) as pool:
        task = pool.submit(value.load, path)
        try:
            assert entered.wait(2)
            assert value.model is old_model
            torch.testing.assert_close(value.model(sample().x, sample().edge_index), expected_old)
        finally:
            release.set()
        task.result(timeout=3)
    assert value.model is not old_model
    torch.testing.assert_close(value.model(sample().x, sample().edge_index), source.model(sample().x, sample().edge_index))


def test_save_and_restore_native_operations_are_serialized(tmp_path, monkeypatch):
    value = trained()
    incoming = tmp_path / 'incoming.pth'
    outgoing = tmp_path / 'outgoing.pth'
    torch.save(checkpoint(value), incoming)
    entered, release, load_entered = threading.Event(), threading.Event(), threading.Event()
    original_save, original_load = torch.save, torch.load
    def blocked_save(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return original_save(*args, **kwargs)
    def observed_load(*args, **kwargs):
        load_entered.set()
        return original_load(*args, **kwargs)
    monkeypatch.setattr(torch, 'save', blocked_save)
    monkeypatch.setattr(torch, 'load', observed_load)
    with ThreadPoolExecutor(max_workers=2) as pool:
        saving = pool.submit(value.save, str(outgoing))
        try:
            assert entered.wait(2)
            loading = pool.submit(value.load, str(incoming))
            assert not load_entered.wait(0.05)
        finally:
            release.set()
        saving.result(timeout=3)
        loading.result(timeout=3)
    assert load_entered.is_set()
    saved = original_load(outgoing)
    assert set(saved) == {'model_state_dict', 'optimizer_state_dict'}
