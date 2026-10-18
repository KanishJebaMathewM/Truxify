"""Owned toy rule observations and categorical/continuous recommendation identity."""

import copy
import math
from numbers import Real

import numpy as np
import torch

MAX_RULES = 128
RULES = {'speed': ('max_speed', 80, 0, False), 'lane': ('max_deviation', .5, 1, False),
         'distance': ('min_distance', 50, 2, False), 'brake': ('max_brake', .8, 2, True)}


class AdvisoryAdmissionError(ValueError):
    """Complete observations or rule configuration cannot enter toy evaluation."""


def vector(value, name):
    raw = np.asarray(value)
    if raw.ndim != 1 or not 1 <= raw.size <= 4096 or raw.dtype.kind not in 'iuf':
        raise AdvisoryAdmissionError(f'{name} must be a bounded flat real numeric vector')
    owned = raw.astype(np.float64, copy=True)
    if not np.isfinite(owned).all():
        raise AdvisoryAdmissionError(f'{name} must contain only finite observations')
    return owned


def own_rule(rule):
    if not isinstance(rule, dict) or not isinstance(rule.get('type'), str) or rule['type'] not in RULES:
        raise AdvisoryAdmissionError('rule type must be speed, lane, distance or brake')
    field, default, _, _ = RULES[rule['type']]
    if not set(rule).issubset({'type', 'description', field}):
        raise AdvisoryAdmissionError('rule fields must match the selected rule type')
    threshold = rule.get(field, default)
    if isinstance(threshold, bool) or not isinstance(threshold, Real):
        raise AdvisoryAdmissionError('rule threshold must be a real number')
    try:
        threshold = float(threshold)
    except (OverflowError, ValueError) as exc:
        raise AdvisoryAdmissionError('rule threshold must be finitely representable') from exc
    if not math.isfinite(threshold) or not 0 <= threshold <= 1e9:
        raise AdvisoryAdmissionError('rule threshold must be finite and nonnegative within the library bound')
    description = rule.get('description', rule['type'])
    if not isinstance(description, str) or not 1 <= len(description) <= 256:
        raise AdvisoryAdmissionError('rule description must contain 1..256 characters')
    return {'type': rule['type'], field: float(threshold), 'description': description}


def evaluate_rules(rules, state, action):
    if not isinstance(rules, (list, tuple)) or len(rules) > MAX_RULES:
        raise AdvisoryAdmissionError('rule collection exceeds admitted capacity')
    rules = [own_rule(rule) for rule in rules]
    state, action = vector(state, 'state'), vector(action, 'action')
    for rule in rules:
        _, _, index, action_field = RULES[rule['type']]
        if len(action if action_field else state) <= index:
            raise AdvisoryAdmissionError('observation lacks a coordinate required by configured rules')
    if not rules:
        return {'safe': None, 'evaluated': False, 'message': 'No rules configured', 'violations': []}
    violations = []
    for rule in rules:
        field, _, index, action_field = RULES[rule['type']]
        observed = float((action if action_field else state)[index])
        compared = abs(observed) if rule['type'] == 'lane' else observed
        failed = compared < rule[field] if rule['type'] == 'distance' else compared > rule[field]
        if failed:
            violations.append({'type': rule['type'], 'description': rule['description'],
                               'observed': observed, 'threshold': rule[field]})
    return {'safe': not violations, 'evaluated': True,
            'message': '; '.join(rule['description'] for rule in violations) if violations else 'Configured rules satisfied',
            'violations': violations}


def _input(module, state):
    parameter = next(module.parameters())
    if parameter.device.type not in ('cpu', 'cuda') or parameter.dtype not in (torch.float32, torch.float64):
        raise AdvisoryAdmissionError('advisory inference requires float32/64 CPU or CUDA model state')
    tensor = torch.tensor(state, device=parameter.device, dtype=parameter.dtype)[None]
    if not torch.isfinite(tensor).all():
        raise AdvisoryAdmissionError('state cannot be represented in the model dtype')
    return tensor


def recommend(model, state, safety_check):
    if not isinstance(safety_check, bool):
        raise AdvisoryAdmissionError('safety_check must be a boolean')
    state = vector(state, 'state')
    if len(state) != model.state_dim:
        raise AdvisoryAdmissionError('state must contain exactly state_dim observations')
    # Own/admit input and active rule schema before changing any module mode.
    bc_input = _input(model.behavioral_cloning, state)
    pg_input = _input(model.policy_gradient.policy, state)
    rules = copy.deepcopy(model.safety.safety_rules)
    if safety_check:
        evaluate_rules(rules, state, np.zeros(model.action_dim))
    modules = list(model.behavioral_cloning.modules()) + list(model.policy_gradient.policy.modules())
    modes = [(module, module.training) for module in modules]
    try:
        model.behavioral_cloning.eval()
        model.policy_gradient.policy.eval()
        with torch.no_grad():
            bc = model.behavioral_cloning(bc_input)
            probabilities = model.policy_gradient.policy(pg_input)
        if (bc.shape != (1, model.action_dim) or probabilities.shape != (1, model.action_dim)
                or not torch.isfinite(bc).all() or not torch.isfinite(probabilities).all()
                or not ((probabilities >= 0) & (probabilities <= 1)).all()
                or not torch.allclose(probabilities.sum(-1), probabilities.new_ones(1),
                                      rtol=0, atol=8 * torch.finfo(probabilities.dtype).eps * model.action_dim)):
            raise ValueError('native recommendation outputs must be compatible finite vectors and probabilities')
        category = int(probabilities[0].argmax().item())
        cloning = bc[0].detach().cpu().numpy().astype(np.float64, copy=True)
        action = np.clip(cloning, -1, 1)
        initial = (evaluate_rules(rules, state, action) if safety_check else
                   {'safe': None, 'evaluated': False, 'message': 'Rule evaluation disabled', 'violations': []})
        adjusted = False
        if initial['safe'] is False:
            candidate = vector(model._adjust_action(state, action), 'advisory candidate')
            if candidate.shape != action.shape:
                raise ValueError('advisory candidate must preserve control coordinate identity')
            candidate = np.clip(candidate, -1, 1)
            adjusted = not np.array_equal(action, candidate)
            action = candidate
        final = evaluate_rules(rules, state, action) if safety_check else initial
        return {'action': action.tolist(), 'bc_action': cloning.tolist(), 'pg_action': category,
                'pg_probabilities': probabilities[0].detach().cpu().tolist(),
                'action_source': 'behavioral_cloning_advisory' if adjusted else 'behavioral_cloning',
                'adjusted': adjusted, 'initial_evaluation': initial, **final}
    finally:
        for module, training in modes:
            module.training = training
