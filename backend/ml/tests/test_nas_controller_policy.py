"""Independent categorical/Adam references and native NAS policy consumers."""
import copy
import math

import pytest
import torch
from nas.model import NASModel, NASSearcher, NASSearchSpace, RLNASController


def space():
    result = NASSearchSpace()
    result.num_layers_range = (1, 1)
    result.num_filters_range = (8, 8)
    result.operations = ['identity', 'zero']
    result.activation_functions = ['relu']
    return result


def controller(dtype=torch.float64):
    m = RLNASController(space())
    m.controller.to(dtype=dtype)
    with torch.no_grad():
        for p in m.controller.parameters(): p.zero_()
    return m


@pytest.mark.parametrize('reward', [1., -1., 0.])
@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_independent_uniform_categorical_policy_gradient_and_native_adam(reward, dtype):
    m = controller(dtype)
    architecture = m.sample_architecture()
    action = m.operations.index(architecture['layers'][0])
    probability = torch.softmax(m.controller.heads[1].bias.detach(), dim=0)[action].item()
    ids = [id(p) for p in m.controller.parameters()]
    result = m.update_controller(architecture, reward)
    assert result['loss'] == pytest.approx(reward * math.log(2), abs=1e-6)
    assert result['advantage'] == reward and result['baseline'] == pytest.approx(.1 * reward)
    assert result['updates'] == 1 and m.best_accuracy == reward
    assert m.best_architecture == architecture and m.best_architecture is not architecture
    bias = m.controller.heads[1].bias
    if reward:
        # d[-r log softmax(z)_a]/dz_j = r*(p_j - 1[j=a]).
        reference = torch.tensor([reward * (.5 - (i == action)) for i in range(2)], dtype=dtype)
        torch.testing.assert_close(bias.grad, reference)
        # First ordinary Adam update includes bias corrections, leaving g/(|g|+eps).
        torch.testing.assert_close(bias, -.001 * reference / (reference.abs() + 1e-8))
        assert m.optimizer.state[bias]['step'] == 1
        new_probability = torch.softmax(bias.detach(), dim=0)[action].item()
        assert new_probability > probability if reward > 0 else new_probability < probability
    else:
        assert not m.optimizer.state
        torch.testing.assert_close(bias, torch.zeros_like(bias))
    assert ids == [id(p) for p in m.controller.parameters()]


def test_prior_baseline_and_consumed_on_policy_identity():
    m = controller()
    a = m.sample_architecture()
    m.update_controller(a, 10.)
    with pytest.raises(ValueError, match='outstanding'): m.update_controller(a, 10.)
    b = m.sample_architecture()
    with pytest.raises(ValueError, match='consume'): m.sample_architecture()
    result = m.update_controller(b, -2.)
    assert result['advantage'] == -3.
    assert result['baseline'] == pytest.approx(.7)
    assert m.best_accuracy == 10. and m.best_architecture == a


def test_sampling_invokes_actual_policy_and_never_uniform_search(monkeypatch):
    m = controller()
    monkeypatch.setattr(m.search_space, 'sample_random_architecture', lambda: pytest.fail('uniform bypass'))
    with torch.no_grad(): m.controller.heads[1].bias.copy_(torch.tensor([100., -100.]))
    a = m.sample_architecture()
    assert a['layers'] == ['identity']
    assert m._pending[1] == (0, 0, 0, 0)


def test_autoregressive_trajectory_logprob_matches_independent_logsumexp():
    m = RLNASController(NASSearchSpace())
    m.controller.double()
    a = m.sample_architecture()
    actions = m._pending[1]
    previous, state, reference = m.controller.bos, None, torch.tensor(0., dtype=torch.float64)
    for position, action in enumerate(actions):
        kind = 0 if position == 0 else 1 + (position - 1) % 3
        token = torch.tensor([previous])
        state = m.controller.cell(m.controller.embedding(token), state)
        logits = m.controller.heads[kind](state[0]).squeeze(0)
        reference = reference + logits[action] - torch.logsumexp(logits, dim=0)
        previous = m.controller.offsets[kind] + action
    _, actual = m._decode(actions)
    torch.testing.assert_close(actual, reference)
    expected_gradients = torch.autograd.grad(reference, tuple(m.controller.parameters()), allow_unused=True)
    actual_gradients = torch.autograd.grad(actual, tuple(m.controller.parameters()), allow_unused=True)
    for expected, gradient in zip(expected_gradients, actual_gradients):
        if expected is None: assert gradient is None
        else: torch.testing.assert_close(gradient, expected)
    assert len(actions) == 1 + 3 * len(a['layers'])


@pytest.mark.parametrize('reward', [True, float('nan'), float('inf'), '1', 1000001., 10**1000])
def test_invalid_reward_preserves_pending_policy_and_rng(reward):
    m = controller()
    a = m.sample_architecture()
    rng = torch.get_rng_state().clone()
    before = copy.deepcopy(m.controller.state_dict())
    with pytest.raises(ValueError): m.update_controller(a, reward)
    assert m._pending is not None and not m.optimizer.state and m.updates == 0
    assert torch.equal(rng, torch.get_rng_state())
    for key, value in before.items(): torch.testing.assert_close(m.controller.state_dict()[key], value, rtol=0, atol=0)


def test_mutated_trajectory_and_changed_policy_cannot_receive_reward():
    m = controller()
    a = m.sample_architecture()
    saved = copy.deepcopy(a)
    a['layers'][0] = 'other'
    with pytest.raises(ValueError, match='differs'): m.update_controller(a, 1.)
    with torch.no_grad(): m.controller.heads[1].bias.add_(.1)
    with pytest.raises(ValueError, match='changed policy'): m.update_controller(saved, 1.)
    m.discard_sample()
    fresh = m.sample_architecture()
    assert fresh['layers'][0] in m.operations
    m.update_controller(fresh, 1.)


@pytest.mark.parametrize('kind', ['native-moment-overflow', 'post-step-failure'])
def test_failed_actual_adam_candidate_recovers_identity_moments_and_prior_gradients(kind, monkeypatch):
    m = RLNASController(space())
    a = m.sample_architecture()
    m.update_controller(a, 1.)
    a = m.sample_architecture()
    params = list(m.controller.parameters())
    for p in params: p.grad = torch.full_like(p, .125)
    if kind == 'native-moment-overflow':
        m.optimizer.param_groups[0]['weight_decay'] = 1e38
    else:
        original = m.optimizer.step
        def fail(*args, **kwargs):
            original(*args, **kwargs)
            raise RuntimeError('after real Adam')
        monkeypatch.setattr(m.optimizer, 'step', fail)
    before, optimizer = copy.deepcopy(m.controller.state_dict()), copy.deepcopy(m.optimizer.state_dict())
    old_ids = [id(p) for p in params]
    baseline, updates, best = m.baseline, m.updates, copy.deepcopy(m.best_architecture)
    with pytest.raises(RuntimeError): m.update_controller(a, 2.)
    assert old_ids == [id(p) for p in m.controller.parameters()]
    for key, value in before.items(): torch.testing.assert_close(m.controller.state_dict()[key], value, rtol=0, atol=0)
    for key, state in optimizer['state'].items():
        for name, value in state.items():
            torch.testing.assert_close(m.optimizer.state_dict()['state'][key][name], value, rtol=0, atol=0)
    for p in params: torch.testing.assert_close(p.grad, torch.full_like(p, .125), rtol=0, atol=0)
    assert (m.baseline, m.updates, m.best_architecture) == (baseline, updates, best)
    assert m._pending is not None


def test_snapshot_search_space_is_owned_and_all_decisions_aligned():
    s = NASSearchSpace()
    m = RLNASController(s)
    s.operations[:] = ['invalid']
    s.activation_functions.clear()
    s.num_layers_range = (100, 200)
    for _ in range(10):
        a = m.sample_architecture()
        assert 3 <= len(a['layers']) <= 10
        assert len(a['layers']) == len(a['filters']) == len(a['activations'])
        assert all(v in m.operations for v in a['layers'])
        assert all(32 <= v <= 256 and v % 8 == 0 for v in a['filters'])
        assert all(v in m.activations for v in a['activations'])
        m.discard_sample()


@pytest.mark.parametrize('kwargs', [{'num_layers_range': (0, 1)}, {'num_layers_range': (1, 33)},
                                  {'num_filters_range': (1, 7)}, {'operations': []},
                                  {'operations': ['identity', 'identity']}, {'operations': ['unsupported']}])
def test_constructor_rejection_before_policy_rng(kwargs):
    s = space()
    for key, value in kwargs.items(): setattr(s, key, value)
    rng = torch.get_rng_state().clone()
    with pytest.raises(ValueError): RLNASController(s)
    assert torch.equal(rng, torch.get_rng_state())


def test_actual_native_search_evaluator_scores_remain_paired_and_owned():
    s = space()
    s.num_layers_range = (1, 2)
    s.operations = ['conv3x3', 'identity', 'zero']
    search = NASSearcher(s)
    observed = []
    def evaluate(a):
        owned = copy.deepcopy(a)
        native = NASModel(a, input_shape=(1, 4, 4))
        output = native(torch.ones(1, 1, 4, 4))
        assert output.shape == (1, 10) and torch.isfinite(output).all()
        reward = -native.get_params()
        observed.append((owned, reward))
        a.clear()
        return reward
    result = search.reinforcement_search(4, evaluate)
    assert result['score_source'] == 'provided_evaluator'
    assert result['method'] == 'reinforcement'
    for record, (a, reward) in zip(result['history'], observed):
        assert record['architecture'] == a and record['score'] == reward
        assert record['policy_update']['reward'] == reward
    winner = max(observed, key=lambda pair: pair[1])
    assert result['best_architecture'] == winner[0] and result['best_score'] == winner[1]
    result['best_architecture']['layers'].clear()
    result['history'].clear()
    assert search.best_architecture == winner[0] and len(search.search_history) == 4


def test_invalid_or_failing_evaluator_never_overwrites_completed_search():
    search = NASSearcher(space())
    old = search.reinforcement_search(1, lambda _a: 1.)
    before = copy.deepcopy(search.search_history)
    for evaluator in (None, lambda _a: float('nan')):
        with pytest.raises(ValueError): search.reinforcement_search(1, evaluator)
        assert search.search_history == before and search.best_architecture == old['best_architecture']
    with pytest.raises(ValueError): search.reinforcement_search(129, lambda _a: 1.)


def test_parallel_samplers_cannot_publish_two_outstanding_trajectories():
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier
    m = controller()
    barrier = Barrier(2)
    def sample():
        barrier.wait()
        try:
            return m.sample_architecture()
        except ValueError:
            return None
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _i: sample(), range(2)))
    assert sum(value is not None for value in results) == 1
    m.update_controller(next(value for value in results if value is not None), 1.)


def test_precision_change_invalidates_outstanding_policy_generation():
    m = controller(torch.float32)
    a = m.sample_architecture()
    m.controller.double()
    with pytest.raises(ValueError, match='changed policy'): m.update_controller(a, 1.)
    assert m.updates == 0 and not m.optimizer.state
