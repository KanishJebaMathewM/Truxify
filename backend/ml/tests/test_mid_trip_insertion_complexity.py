"""Independent full-route oracle and deterministic work/memory bounds."""
import math
import random
import tracemalloc
from datetime import datetime, timedelta, timezone
from itertools import pairwise

import pytest
from app.models import mid_trip_reoptimiser as model


def oracle(route, pickup, dropoff, distances, durations):
    def total(matrix, path):
        return sum(matrix[a][b] for a, b in pairwise(path))
    baseline = [total(matrix, route) for matrix in (distances, durations)]
    result = []
    for p in range(len(route)):
        augmented = route[:p + 1] + [pickup] + route[p + 1:]
        prefix = [total(matrix, augmented[:p + 2]) for matrix in (distances, durations)]
        for q in range(p + 2, len(augmented) + 1):
            candidate = augmented[:q] + [dropoff] + augmented[q:]
            result.append(tuple(max(total(matrix, candidate) - base, 0.0)
                                for matrix, base in zip((distances, durations), baseline))
                          + tuple(prefix))
    return result


@pytest.mark.parametrize('waypoints', [0, 1, 2, 5, 12])
@pytest.mark.parametrize('seed', range(12))
def test_every_directed_option_matches_full_route_oracle(waypoints, seed):
    rng = random.Random(seed)
    size = waypoints + 3
    # Nonmetric directed costs prevent accidental reliance on symmetry or
    # triangle inequalities. Repeated route indices represent revisited stops.
    route = [rng.randrange(waypoints + 1) for _ in range(waypoints + 1)]
    matrices = [[[rng.uniform(0, 1000) for _ in range(size)]
                 for _ in range(size)] for _ in range(2)]
    expected = oracle(route, size - 2, size - 1, *matrices)
    actual = model._route_insertion_options_with_matrix(route, size - 2, size - 1, *matrices)
    assert len(actual) == (waypoints + 1) * (waypoints + 2) // 2
    for got, wanted in zip(actual, expected):
        assert got == pytest.approx(wanted, abs=1e-8)
    assert model._best_route_insertion_with_matrix(route, size - 2, size - 1, *matrices) == pytest.approx(min(expected), abs=1e-8)


@pytest.mark.parametrize('value', [float('inf'), float('-inf'), float('nan'), 1e308])
def test_nonfinite_input_retains_full_route_arithmetic(value):
    matrix = [[1.0] * 4 for _ in range(4)]
    matrix[0][1] = value
    expected = oracle([0, 1], 2, 3, matrix, matrix)
    actual = list(model._iter_route_insertion_options_with_matrix([0, 1], 2, 3, matrix, matrix))
    for got, wanted in zip(actual, expected):
        for a, b in zip(got, wanted):
            assert (math.isnan(a) and math.isnan(b)) or a == b


def test_finite_zero_cost_ties_and_empty_compatibility():
    matrix = [[0.0] * 5 for _ in range(5)]
    assert model._route_insertion_options_with_matrix([], 3, 4, matrix, matrix) == []
    assert model._route_insertion_options_with_matrix([0, 1, 2], 3, 4, matrix, matrix) == [(0.0, 0.0, 0.0, 0.0)] * 6


@pytest.mark.parametrize('waypoints', [20, 40, 80])
def test_matrix_work_is_linear_and_exhaustive_options_are_quadratic(waypoints):
    class Row(list):
        reads = 0
        def __getitem__(self, index):
            type(self).reads += 1
            return super().__getitem__(index)
    size = waypoints + 3
    matrix = [Row([float(abs(i - j) + 1) for j in range(size)]) for i in range(size)]
    actual = model._route_insertion_options_with_matrix(list(range(waypoints + 1)), size - 2, size - 1, matrix, matrix)
    assert len(actual) == (waypoints + 1) * (waypoints + 2) // 2
    assert Row.reads <= 12 * (waypoints + 1)


def test_active_recommender_streams_candidates_without_retaining_lists(monkeypatch):
    monkeypatch.setattr(model, 'get_route_matrix_with_duration', lambda _: ([[0.0] * 3 for _ in range(3)], [[0.0] * 3 for _ in range(3)]))
    def forbidden_list(*args):
        raise AssertionError('active caller must not materialize compatibility list')
    monkeypatch.setattr(model, '_route_insertion_options_with_matrix', forbidden_list)
    consumed = 0
    def candidates(*args):
        nonlocal consumed
        for i in range(100000):
            consumed += 1
            # Fresh tuples/floats expose a retained candidate-list regression.
            yield (float(i + 1), float(i + 1), float(i % 10), float(i % 10))
    monkeypatch.setattr(model, '_iter_route_insertion_options_with_matrix', candidates)
    deadline = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
    tracemalloc.start()
    try:
        result = model.find_mid_trip_loads(
            {'lat': 0, 'lng': 0}, [],
            {'weight_kg': 1000, 'length_m': 10, 'width_m': 3, 'height_m': 3},
            [{'load_id': 'streamed', 'pickup_lat': 0, 'pickup_lng': 0,
              'dropoff_lat': 0, 'dropoff_lng': 0, 'weight_kg': 1,
              'length_m': 1, 'width_m': 1, 'height_m': 1,
              'payment_inr': 1000, 'pickup_deadline': deadline}],
        )
        _, peak = tracemalloc.get_traced_memory()
    finally:
        tracemalloc.stop()
    assert consumed == 100000
    assert peak < 1_000_000
    assert result['recommendations'][0]['load_id'] == 'streamed'
    assert result['recommendations'][0]['detour_km'] == 1
