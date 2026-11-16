"""Accepted assignment optimality checked against an independent exhaustive oracle."""
import itertools

import numpy as np
import pytest
from app.models import bilateral_matcher as matcher


def oracle_gain(cost):
    """Enumerate partial injections; rejected edges are never available."""
    best = 0.0
    for choices in itertools.product(range(-1, cost.shape[1]), repeat=cost.shape[0]):
        drivers = [j for j in choices if j >= 0]
        if len(drivers) != len(set(drivers)):
            continue
        gain = 0.0
        for i, j in enumerate(choices):
            if j < 0:
                continue
            value = cost[i, j]
            if not np.isfinite(value) or value >= 200:
                break
            gain += 200 - value
        else:
            best = max(best, gain)
    return best


def assert_optimal(cost):
    pairs = matcher._optimal_accepted_pairs(cost)
    assert len({i for i, _ in pairs}) == len(pairs)
    assert len({j for _, j in pairs}) == len(pairs)
    assert pairs == sorted(pairs)
    assert all(np.isfinite(cost[i, j]) and cost[i, j] < 200 for i, j in pairs)
    gain = sum(200 - cost[i, j] for i, j in pairs)
    assert gain == pytest.approx(oracle_gain(cost))
    return pairs


@pytest.mark.parametrize('shape', [(1, 1), (1, 4), (4, 1), (2, 3), (3, 2), (3, 3), (4, 3)])
def test_random_rectangles_match_independent_exhaustive_oracle(shape):
    rng = np.random.default_rng(16931)
    values = np.array([-10, 0, 50, 117, 169, 199.99, 200, 275, 1e6, np.inf])
    for _ in range(40):
        assert_optimal(rng.choice(values, size=shape))


@pytest.mark.parametrize('cost', [
    [[117, 275], [169, 1e6]],
    [[117, 169], [275, 1e6]],
    [[199.99, 200, np.inf]],
    [[np.inf, np.nan], [1e6, 200]],
    [[-10, -10], [-10, -10]],
    [[0, 199], [199, 1e6]],
])
def test_boundaries_ties_and_competing_poor_edges(cost):
    assert_optimal(np.array(cost, dtype=float))


@pytest.mark.parametrize('shape', [(0, 0), (0, 2), (2, 0)])
def test_empty_partitions(shape):
    assert matcher._optimal_accepted_pairs(np.zeros(shape)) == []


@pytest.mark.parametrize('shape', [(2, 1000), (1000, 2)])
def test_rectangular_solver_allocation_for_unequal_partitions(monkeypatch, shape):
    actual_solver = matcher.linear_sum_assignment
    recorded = []

    def record(matrix):
        recorded.append((matrix.shape, matrix.nbytes))
        return actual_solver(matrix)

    monkeypatch.setattr(matcher, 'linear_sum_assignment', record)
    pairs = matcher._optimal_accepted_pairs(np.ones(shape))
    assert len(pairs) == 2
    assert recorded == [((2, 1002), 2 * 1002 * 8)]
    assert recorded[0][1] < (sum(shape) ** 2 * 8) / 500


def test_actual_geographic_costs_preserve_better_accepted_match(monkeypatch):
    monkeypatch.setenv('TRUXIFY_ML_USE_OSRM', 'false')
    loads = [{'origin_lat': 0, 'origin_lng': lng, 'dest_lat': 0, 'dest_lng': lng,
                  'weight_kg': weight, 'length_m': 2, 'width_m': 2, 'height_m': 2, 'deadline_hours': 1000}
             for lng, weight in [(0, 500), (-13, 3000)]]
    drivers = [{'current_lat': 0, 'current_lng': lng, 'max_weight_kg': capacity,
                    'max_length_m': 5, 'max_width_m': 3, 'max_height_m': 3, 'rating': 3}
               for lng, capacity in [(30, 5000), (70, 1000)]]
    result = matcher.match_bilateral(loads, drivers)
    assert result['assignments'] == [{'load_index': 0, 'driver_index': 0, 'match_score': 0.4107}]
    assert result['unmatched_loads'] == [1]
    assert result['unmatched_drivers'] == [1]
