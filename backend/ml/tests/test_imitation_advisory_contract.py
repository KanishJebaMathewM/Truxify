"""Native categorical identity, owned toy predicates and mounted recommendation contract."""

import copy
import importlib
import sys

import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from imitation.advisory import evaluate_rules
from imitation.model import ImitationLearningModel, SafetyConstraints


def native(dtype=torch.float32):
    model = ImitationLearningModel(3, 4, 4)
    model.behavioral_cloning.to(dtype=dtype)
    model.policy_gradient.policy.to(dtype=dtype)
    with torch.no_grad():
        for p in model.behavioral_cloning.parameters():
            p.zero_()
        model.behavioral_cloning.policy[-1].bias.copy_(torch.tensor([.2, -.3, .4, .5], dtype=dtype))
        for p in model.policy_gradient.policy.parameters():
            p.zero_()
        model.policy_gradient.policy[-2].bias.copy_(torch.tensor([-1., 2., 5., 0.], dtype=dtype))
    return model


def module_state(model):
    return (copy.deepcopy(model.behavioral_cloning.state_dict()),
            copy.deepcopy(model.policy_gradient.policy.state_dict()),
            [m.training for m in model.behavioral_cloning.modules()],
            [m.training for m in model.policy_gradient.policy.modules()])


def unchanged(model, before):
    after = module_state(model)
    for actual, expected in zip(after[:2], before[:2]):
        for name in actual:
            assert torch.equal(actual[name], expected[name])
    assert after[2:] == before[2:]


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_actual_native_category_is_separate_from_continuous_coordinates(dtype):
    model = native(dtype)
    result = model.predict_action(np.array([50., 0., 60.]))
    assert result['pg_action'] == 2 and isinstance(result['pg_action'], int)
    np.testing.assert_allclose(result['action'], [.2, -.3, .4, .5], rtol=1e-6)
    np.testing.assert_allclose(result['bc_action'], result['action'])
    expected = np.exp(np.array([-1., 2., 5., 0.]) - 5)
    expected /= expected.sum()
    np.testing.assert_allclose(result['pg_probabilities'], expected, rtol=1e-6)
    assert result['action_source'] == 'behavioral_cloning'
    assert result['safe'] is True and result['evaluated'] is True
    assert len(model.safety.safety_rules) == 4


@pytest.mark.parametrize('state,type_name', [([100., 0., 60.], 'speed'),
                                           ([50., 1., 60.], 'lane'),
                                           ([50., 0., 10.], 'distance')])
def test_advisory_adjustment_cannot_hide_unchanged_observed_violation(state, type_name):
    model = native()
    result = model.predict_action(state)
    assert result['initial_evaluation']['safe'] is False
    assert result['safe'] is False
    assert type_name in [v['type'] for v in result['violations']]
    assert result['evaluated'] is True


def test_actual_flat_brake_coordinate_is_evaluated():
    model = native()
    with torch.no_grad():
        model.behavioral_cloning.policy[-1].bias[2] = .9
    result = model.predict_action([50., 0., 60.])
    assert result['safe'] is False
    assert result['violations'][0]['type'] == 'brake'
    assert result['violations'][0]['observed'] == pytest.approx(.9)


def test_disabled_evaluation_is_unknown_and_does_not_certify_action():
    result = native().predict_action([100., 5., 1.], safety_check=False)
    assert result['safe'] is None and result['evaluated'] is False
    assert result['message'] == 'Rule evaluation disabled'
    assert not result['adjusted']


@pytest.mark.parametrize('type_name,field,observation,index,action_field', [
    ('speed', 'max_speed', 80., 0, False), ('lane', 'max_deviation', .5, 1, False),
    ('distance', 'min_distance', 50., 2, False), ('brake', 'max_brake', .8, 2, True)])
def test_independent_inclusive_threshold_and_violation_reference(type_name, field, observation, index, action_field):
    rule = {'type': type_name, field: observation, 'description': type_name}
    state, action = np.array([50., 0., 60.]), np.zeros(4)
    target = action if action_field else state
    target[index] = observation
    assert evaluate_rules([rule], state, action)['safe'] is True
    target[index] = observation - .01 if type_name == 'distance' else observation + .01
    result = evaluate_rules([rule], state, action)
    assert result['safe'] is False
    assert result['violations'] == [{'type': type_name, 'description': type_name,
                                     'observed': float(target[index]), 'threshold': observation}]
    if type_name == 'lane':
        target[index] = -observation - .01
        assert evaluate_rules([rule], state, action)['safe'] is False


@pytest.mark.parametrize('rule', [None, {}, {'type': 'unknown'}, {'type': 'speed', 'max_speed': float('nan')},
                                 {'type': 'speed', 'max_speed': -1}, {'type': 'brake', 'max_brake': True},
                                 {'type': 'speed', 'max_speed': '80'}, {'type': 'lane', 'min_distance': 2},
                                 {'type': 'distance', 'description': ''}, {'type': 'speed', 'max_speed': 10 ** 400}])
def test_malformed_rule_rejected_before_collection_publication(rule):
    safety = SafetyConstraints()
    safety.add_rule({'type': 'speed'})
    before = safety.safety_rules
    with pytest.raises(ValueError):
        safety.add_rule(rule)
    assert safety.safety_rules == before


@pytest.mark.parametrize('state,action', [(np.full(3, np.nan), np.zeros(4)),
                                        (np.array([50., 0.]), np.zeros(4)),
                                        (np.array([50., 0., 60.]), np.array([[0., 0., .9, 0.]])),
                                        (np.array([50., 0., 60.]), np.zeros(2)),
                                        (['50', '0', '60'], np.zeros(4)),
                                        ([50., 0., 60.], [0., 0., float('inf'), 0.])])
def test_missing_nonfinite_or_nested_observations_never_satisfy_rules(state, action):
    safety = SafetyConstraints()
    for rule in safety.get_default_rules():
        safety.add_rule(rule)
    with pytest.raises(ValueError):
        safety.check_safety(state, action)


def test_rule_and_returned_collection_are_defensively_owned():
    safety = SafetyConstraints()
    rule = {'type': 'speed', 'max_speed': 80, 'description': 'speed'}
    safety.add_rule(rule)
    rule['max_speed'] = float('nan')
    view = safety.safety_rules
    view[0]['max_speed'] = 999
    view.append({'type': 'unknown'})
    assert safety.check_safety(np.array([100., 0., 60.]), np.zeros(4))[0] is False
    assert safety.safety_rules[0]['max_speed'] == 80
    assert len(safety.safety_rules) == 1


def test_empty_rule_set_is_unevaluated_not_satisfied():
    result = evaluate_rules([], [50., 0., 60.], [0., 0., 0., 0.])
    assert result['safe'] is None and result['evaluated'] is False
    assert SafetyConstraints().check_safety(np.ones(3), np.zeros(4))[0] is False


@pytest.mark.parametrize('state', [[50., 0.], [50., 0., float('nan')], [[50., 0., 60.]],
                                  [True, False, True], [1e100, 0., 60.]])
def test_native_input_admission_precedes_mode_or_weight_changes(state):
    model = native()
    before = module_state(model)
    with pytest.raises(ValueError):
        model.predict_action(state)
    unchanged(model, before)


def test_native_eval_preserves_mixed_modes_weights_and_prior_gradients():
    model = native()
    model.behavioral_cloning.train()
    model.behavioral_cloning.policy[2].eval()
    model.policy_gradient.policy.train()
    model.policy_gradient.policy[2].eval()
    for p in model.behavioral_cloning.parameters():
        p.grad = torch.ones_like(p)
    before = module_state(model)
    result = model.predict_action([50., 0., 60.])
    assert result['safe'] is True
    unchanged(model, before)
    assert all(torch.equal(p.grad, torch.ones_like(p)) for p in model.behavioral_cloning.parameters())


def test_native_callback_failure_restores_modes():
    model = native()
    before = module_state(model)

    def failure(module, args):
        raise RuntimeError('controlled native encoder callback')

    hook = model.policy_gradient.policy.register_forward_pre_hook(failure)
    try:
        with pytest.raises(RuntimeError, match='controlled'):
            model.predict_action([50., 0., 60.])
    finally:
        hook.remove()
    unchanged(model, before)


def test_caller_state_mutation_cannot_change_inference_or_rule_observation():
    model = native()
    state = np.array([50., 0., 60.])

    def mutation(module, args):
        state.fill(np.nan)

    hook = model.behavioral_cloning.register_forward_pre_hook(mutation)
    try:
        result = model.predict_action(state)
    finally:
        hook.remove()
    assert result['safe'] is True and result['pg_action'] == 2


def test_native_nonfinite_output_is_rejected_and_modes_restored():
    model = native()
    with torch.no_grad():
        model.behavioral_cloning.policy[-1].bias[0] = float('nan')
    modes = ([m.training for m in model.behavioral_cloning.modules()],
             [m.training for m in model.policy_gradient.policy.modules()])
    with pytest.raises(ValueError, match='outputs'):
        model.predict_action([50., 0., 60.])
    assert modes == ([m.training for m in model.behavioral_cloning.modules()],
                     [m.training for m in model.policy_gradient.policy.modules()])


def test_rule_capacity_admission_before_publication(monkeypatch):
    import imitation.model as source

    monkeypatch.setattr(source, 'MAX_RULES', 1)
    safety = SafetyConstraints()
    safety.add_rule({'type': 'speed'})
    with pytest.raises(ValueError):
        safety.add_rule({'type': 'lane'})
    assert len(safety.safety_rules) == 1


@pytest.fixture
def mounted():
    name = 'routes.imitation_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def test_actual_default_mounted_prediction_serializes_category_and_flat_advisory(mounted):
    client, _route = mounted
    state = [50., 0., 60.] + [0.] * 61
    response = client.post('/imitation/predict', json=state)
    assert response.status_code == 200, response.text
    result = response.json()['data']
    assert len(result['action']) == 4 and len(result['bc_action']) == 4
    assert isinstance(result['pg_action'], int)
    assert result['evaluated'] is True
    assert len(client.get('/imitation/safety/rules').json()['data']) == 4
    disabled = client.post('/imitation/predict?safety_check=false', json=state).json()['data']
    assert disabled['safe'] is None and disabled['evaluated'] is False


@pytest.mark.parametrize('state', [[1., 2.], [True] * 64, ['0'] * 64])
def test_actual_invalid_native_input_is_422(mounted, state):
    client, _route = mounted
    response = client.post('/imitation/predict', json=state)
    assert response.status_code == 422, response.text


def test_actual_typed_rule_admission_and_active_view(mounted):
    client, route = mounted
    old = route.model.safety.safety_rules
    response = client.post('/imitation/safety/rules/add', json={'type': 'unknown'})
    assert response.status_code == 422
    assert route.model.safety.safety_rules == old
    response = client.post('/imitation/safety/rules/add', json={'type': 'speed', 'max_speed': 60})
    assert response.status_code == 200
    assert len(client.get('/imitation/safety/rules').json()['data']) == 5


def test_native_model_output_failure_remains_generic_500(mounted):
    client, route = mounted
    with torch.no_grad():
        route.model.behavioral_cloning.policy[-1].bias[0] = float('nan')
    response = client.post('/imitation/predict', json=[50., 0., 60.] + [0.] * 61)
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'
