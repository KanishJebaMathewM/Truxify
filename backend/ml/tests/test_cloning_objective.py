from copy import deepcopy
import numpy as np
import pytest
import torch
from imitation.model import ImitationLearningModel


def model():
    torch.manual_seed(14)
    return ImitationLearningModel(3, 4, 8)


def paired(rows=5):
    return np.arange(rows * 3).reshape(rows, 3) / 10, np.arange(rows * 4).reshape(rows, 4) / 11


def equal(a, b):
    if isinstance(a, torch.Tensor):
        assert torch.equal(a, b)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            equal(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


@pytest.mark.parametrize('bad', ['column', 'rows', 'state_width', 'action_width', 'late_nan', 'late_inf', 'empty'])
def test_complete_pair_admission_keeps_optimizer_grad_mode_rng(bad):
    m = model()
    states, actions = paired()
    m.train_behavioral_cloning(states, actions, epochs=1)
    m.behavioral_cloning.eval()
    if bad == 'column':
        actions = actions[:, :1]
    elif bad == 'rows':
        actions = actions[:-1]
    elif bad == 'state_width':
        states = states[:, :2]
    elif bad == 'action_width':
        actions = np.pad(actions, ((0, 0), (0, 1)))
    elif bad == 'late_nan':
        actions[-1, -1] = np.nan
    elif bad == 'late_inf':
        states[-1, -1] = np.inf
    else:
        states, actions = states[:0], actions[:0]
    weights = deepcopy(m.behavioral_cloning.state_dict())
    optimizer = deepcopy(m.bc_optimizer.state_dict())
    gradients = [p.grad.clone() for p in m.behavioral_cloning.parameters()]
    rng = torch.get_rng_state().clone()
    numpy_rng = np.random.get_state()
    with pytest.raises(ValueError):
        m.train_behavioral_cloning(states, actions, epochs=2, batch_size=2)
    equal(m.behavioral_cloning.state_dict(), weights)
    equal(m.bc_optimizer.state_dict(), optimizer)
    for p, grad in zip(m.behavioral_cloning.parameters(), gradients):
        assert torch.equal(p.grad, grad)
    assert not m.behavioral_cloning.training
    assert torch.equal(torch.get_rng_state(), rng)
    current = np.random.get_state()
    assert current[0] == numpy_rng[0] and np.array_equal(current[1], numpy_rng[1]) and current[2:] == numpy_rng[2:]


@pytest.mark.parametrize('value', [0, -1, True, 1.5])
def test_budget_admission(value):
    m = model()
    states, actions = paired()
    for kwargs in [{'epochs': value}, {'batch_size': value}]:
        with pytest.raises(ValueError):
            m.train_behavioral_cloning(states, actions, **kwargs)
    assert not m.bc_optimizer.state


@pytest.mark.parametrize('batch_size', [1, 2, 3, 9])
@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_independent_adam_replay_and_row_weighted_metrics(batch_size, dtype):
    m = model()
    m.behavioral_cloning.to(dtype=dtype)
    m.behavioral_cloning.eval()  # simulate preceding inference
    reference = deepcopy(m)
    reference.behavioral_cloning.train()
    states, actions = paired()
    torch.manual_seed(71)
    np.random.seed(72)
    result = m.train_behavioral_cloning(states, actions, epochs=2, batch_size=batch_size)
    torch.manual_seed(71)
    np.random.seed(72)
    expected = []
    for _ in range(2):
        indices = np.random.permutation(5)
        row_losses = []
        for start in range(0, 5, batch_size):
            rows = indices[start:start + batch_size]
            prediction = reference.behavioral_cloning(torch.tensor(states[rows], dtype=dtype))
            target = torch.tensor(actions[rows], dtype=dtype)
            per_row = (prediction - target).square().mean(dim=1)
            loss = per_row.mean()
            reference.bc_optimizer.zero_grad()
            loss.backward()
            reference.bc_optimizer.step()
            row_losses.extend(per_row.detach().tolist())
        expected.append(sum(row_losses) / 5)
    assert result['losses'] == pytest.approx(expected, rel=1e-6)
    assert result['final_loss'] == result['losses'][-1]
    for actual, wanted in zip(m.behavioral_cloning.parameters(), reference.behavioral_cloning.parameters()):
        torch.testing.assert_close(actual, wanted, rtol=1e-6, atol=1e-7)
    equal(m.bc_optimizer.state_dict()['param_groups'], reference.bc_optimizer.state_dict()['param_groups'])
    assert m.behavioral_cloning.training


def test_singleton_registered_keys_and_input_ownership():
    m = model()
    states, actions = paired(1)
    original = states.copy(), actions.copy()
    keys = list(m.behavioral_cloning.state_dict())
    parameters = [id(p) for p in m.behavioral_cloning.parameters()]
    result = m.train_behavioral_cloning(states, actions, epochs=1, batch_size=8)
    assert np.isfinite(result['final_loss'])
    assert list(m.behavioral_cloning.state_dict()) == keys
    assert [id(p) for p in m.behavioral_cloning.parameters()] == parameters
    assert np.array_equal(states, original[0]) and np.array_equal(actions, original[1])


def test_nonrepresentable_objective_does_not_step_adam():
    m = model()
    states, actions = paired()
    actions[:] = np.finfo(np.float32).max
    before = deepcopy(m.behavioral_cloning.state_dict())
    with pytest.raises(ValueError, match='objective'):
        m.train_behavioral_cloning(states, actions, epochs=1)
    equal(m.behavioral_cloning.state_dict(), before)
    assert not m.bc_optimizer.state
