"""Native linear policy contracts against an independent Decimal oracle."""

import json
from decimal import Decimal, localcontext

import numpy as np
import pytest
from marl.mappo_fleet import MappoFleetBalancer


def reference(state, actor, critic):
    with localcontext() as context:
        context.prec = 2500
        states = [Decimal.from_float(float(v)) for v in state]

        def dot(column):
            return sum(
                (x * Decimal.from_float(float(w)) for x, w in zip(states, column)),
                Decimal(0),
            )

        logits = [dot(column) for column in actor.T]
        value = dot(critic[:, 0])
        maximum = max(logits)
        exponentials = [
            Decimal(0) if maximum - score > 1000 else (score - maximum).exp()
            for score in logits
        ]
        total = sum(exponentials)
        return (
            round(float(value), 4),
            [round(float(v / total), 4) for v in exponentials],
            logits.index(maximum),
        )


def check(balancer, state):
    expected = reference(state, balancer.actor_weights, balancer.critic_weights)
    result = balancer.compute_cooperative_actions(state)
    assert result["critic_state_value"] == expected[0]
    assert result["agent_selection_probabilities"] == expected[1]
    assert result["optimal_dispatch_agent_id"] == expected[2]
    assert result["rebalance_action"] == "ROUTE_DISPATCH_ENFORCED"
    json.dumps(result, allow_nan=False)
    return result


@pytest.mark.parametrize(
    "dimensions",
    [
        (0, 4),
        (3, 0),
        (True, 4),
        (3, True),
        (3.0, 4),
        (3, 4.0),
        (257, 4),
        (4, 257),
        (256, 256),
    ],
)
def test_configuration_rejected_before_allocation(dimensions):
    with pytest.raises(ValueError):
        MappoFleetBalancer(num_agents=dimensions[0], state_dim=dimensions[1])


@pytest.mark.parametrize(
    "state",
    [
        np.array([np.nan, 0, 0, 0]),
        np.array([np.inf, 0, 0, 0]),
        np.zeros((4, 1)),
        np.zeros(3),
        np.array([True] * 4),
        np.array(["0"] * 4),
        np.ones(4, dtype=complex),
    ],
)
def test_invalid_state_cannot_enforce_dispatch(state):
    with pytest.raises(ValueError):
        MappoFleetBalancer(3, 4).compute_cooperative_actions(state)


@pytest.mark.parametrize("field", ["actor_weights", "critic_weights"])
@pytest.mark.parametrize("kind", ["nan", "infinity", "shape", "bool", "complex"])
def test_complete_weight_admission(field, kind):
    balancer = MappoFleetBalancer(3, 4)
    original = getattr(balancer, field)
    value = original.copy()
    if kind == "nan":
        value[0, 0] = np.nan
    elif kind == "infinity":
        value[0, 0] = np.inf
    elif kind == "shape":
        value = value[:-1]
    elif kind == "bool":
        value = value.astype(bool)
    elif kind == "complex":
        value = value.astype(complex)
    setattr(balancer, field, value)
    with pytest.raises(ValueError):
        balancer.compute_cooperative_actions(np.ones(4))
    np.testing.assert_array_equal(getattr(balancer, field), value)


def test_cancellation_preserves_actual_winning_agent():
    balancer = MappoFleetBalancer(3, 4)
    balancer.critic_weights[:] = 0
    balancer.actor_weights = np.array([[0.0, 1.0, 0.0]] * 4)
    result = check(balancer, np.array([1e16, 1.0, -1e16, 0.0]))
    assert result["optimal_dispatch_agent_id"] == 1


def test_unrepresentable_absolute_logits_keep_relative_policy():
    balancer = MappoFleetBalancer(3, 4)
    balancer.critic_weights[:] = 0
    balancer.actor_weights = np.array([[1.0, 2.0, 3.0]] * 4)
    result = check(balancer, np.full(4, 1e308))
    assert result["optimal_dispatch_agent_id"] == 2
    assert result["agent_selection_probabilities"] == [0.0, 0.0, 1.0]


def test_product_overflow_cancels_before_critic_conversion():
    balancer = MappoFleetBalancer(3, 4)
    balancer.critic_weights = np.array([[1e308], [1e308], [1.0], [0.0]])
    balancer.actor_weights = np.array(
        [[1e308, 0.0, 0.0], [1e308, 0.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    )
    check(balancer, np.array([1e308, -1e308, 1.0, 0.0]))


def test_true_unrepresentable_critic_refuses_dispatch():
    balancer = MappoFleetBalancer(3, 4)
    balancer.critic_weights[:] = 1
    with pytest.raises(ValueError, match="critic"):
        balancer.compute_cooperative_actions(np.full(4, 1e308))


def test_owned_inputs_and_lowest_exact_tie_keep_compatibility():
    balancer = MappoFleetBalancer(3, 4)
    state = np.array([0.9, 0.2, 0.4, 0.1])
    before = [
        v.copy() for v in (state, balancer.actor_weights, balancer.critic_weights)
    ]
    result = check(balancer, state)
    assert result["optimal_dispatch_agent_id"] == 0
    for actual, expected in zip(
        (state, balancer.actor_weights, balancer.critic_weights), before
    ):
        np.testing.assert_array_equal(actual, expected)


@pytest.mark.parametrize("seed", range(20))
def test_seeded_decimal_policy_reference(seed):
    rng = np.random.default_rng(seed)
    balancer = MappoFleetBalancer(5, 8)
    balancer.actor_weights = rng.normal(size=(8, 5))
    balancer.critic_weights = rng.normal(size=(8, 1))
    check(balancer, rng.normal(size=8))


def test_subnormal_and_common_large_offset_policy():
    balancer = MappoFleetBalancer(3, 4)
    balancer.critic_weights[:] = 0
    balancer.actor_weights = np.array(
        [[1e308] * 3, [0.0, 1.0, 2.0], [0.0, 0.0, 0.0], [0.0, 0.0, 0.0]]
    )
    result = check(balancer, np.array([1.0, 1.0, np.nextafter(0.0, 1.0), 0.0]))
    assert result["optimal_dispatch_agent_id"] == 2


def test_mutated_dimensions_must_match_owned_weight_pair():
    balancer = MappoFleetBalancer(3, 4)
    balancer.num_agents = 2
    with pytest.raises(ValueError):
        balancer.compute_cooperative_actions(np.ones(4))
