"""Actual stop-sequencing equivalence and operation-count regressions."""
import copy
import random

import pytest
from app.models import bin_packing as packing


def oracle(addresses, indices, start):
    remaining = set(indices)
    current = start
    sequence = []
    while remaining:
        nearest = min(remaining, key=lambda index: (
            packing._haversine(current['lat'], current['lng'],
                               addresses[index]['lat'], addresses[index]['lng']),
            index,
        ))
        sequence.append(nearest)
        remaining.remove(nearest)
        current = addresses[nearest]
    return sequence


@pytest.mark.parametrize('seed', range(16))
@pytest.mark.parametrize('global_coordinates', [False, True])
def test_large_sequence_matches_independent_complete_scan(seed, global_coordinates):
    rng = random.Random(seed)
    if global_coordinates:
        addresses = [{'lat': rng.uniform(-89, 89), 'lng': rng.uniform(-180, 180)}
                     for _ in range(540)]
        start = {'lat': rng.uniform(-89, 89), 'lng': rng.uniform(-180, 180)}
    else:
        addresses = [{'lat': rng.uniform(18, 29), 'lng': rng.uniform(70, 85)}
                     for _ in range(540)]
        start = {'lat': 19.076, 'lng': 72.877}
    indices = list(range(len(addresses)))
    rng.shuffle(indices)
    before = copy.deepcopy((addresses, indices, start))
    expected = oracle(addresses, indices, start)
    assert packing._sequence_stops(addresses, indices, start) == expected
    assert (addresses, indices, start) == before


@pytest.mark.parametrize('addresses,start', [
    ([{'lat': 0., 'lng': value} for value in [-180., 180., 179.99, -179.99]],
     {'lat': 0., 'lng': 179.999}),
    ([{'lat': 90., 'lng': value} for value in [-180., -90., 0., 90., 180.]],
     {'lat': 89.999, 'lng': 0.}),
    ([{'lat': -90., 'lng': value} for value in [-170., -10., 0., 10., 170.]],
     {'lat': -89.999, 'lng': 0.}),
    ([{'lat': 0., 'lng': value} for value in [-1., 1., -1e-12, 1e-12, 0.]],
     {'lat': 0., 'lng': 0.}),
    ([{'lat': 0., 'lng': value} for value in [179.999, -179.999, 179.99]],
     {'lat': 0., 'lng': 0.}),
])
def test_spatial_path_boundary_and_near_tie_equivalence(monkeypatch, addresses, start):
    monkeypatch.setattr(packing, '_SPATIAL_INDEX_MIN_STOPS', 1)
    monkeypatch.setattr(packing, '_SPATIAL_INDEX_TAIL_STOPS', 0)
    indices = list(reversed(range(len(addresses))))
    assert packing._sequence_stops(addresses, indices, start) == oracle(addresses, indices, start)


@pytest.mark.parametrize('clustered', [False, True])
def test_duplicate_locations_and_sparse_repeated_package_indices(clustered):
    addresses = [{'lat': 20. + (i % 5 if clustered else 0), 'lng': 75.}
                 for i in range(700)]
    indices = list(range(50, 650)) + [50, 100, 200]
    start = {'lat': 20., 'lng': 75.}
    result = packing._sequence_stops(addresses, indices, start)
    assert result == oracle(addresses, indices, start)
    assert len(result) == len(set(indices))


def test_small_path_does_not_import_scientific_dependency(monkeypatch):
    def forbidden():
        raise AssertionError('small routes must not load the spatial index')
    monkeypatch.setattr(packing, '_get_kdtree', forbidden)
    addresses = [{'lat': 20., 'lng': 75.}, {'lat': 21., 'lng': 75.}]
    start = {'lat': 21., 'lng': 75.}
    assert packing._sequence_stops(addresses, [0, 1], start) == [1, 0]
    assert packing._sequence_stops([], [], {}) == []


def test_missing_scientific_dependency_uses_original_path(monkeypatch):
    monkeypatch.setattr(packing, '_get_kdtree', lambda: None)
    addresses = [{'lat': 20. + i / 1000, 'lng': 75.} for i in range(520)]
    start = {'lat': 20., 'lng': 75.}
    assert packing._sequence_stops(addresses, list(range(520)), start) == list(range(520))


@pytest.mark.parametrize('invalid', [{'lat': float('nan'), 'lng': 0.}, {'lat': 91., 'lng': 0.}])
def test_large_path_preserves_start_validation(invalid):
    addresses = [{'lat': 20., 'lng': 75.} for _ in range(512)]
    with pytest.raises(ValueError, match='route_start.lat'):
        packing._sequence_stops(addresses, list(range(512)), invalid)


def test_large_path_preserves_packed_index_validation():
    addresses = [{'lat': 20., 'lng': 75.} for _ in range(512)]
    with pytest.raises(ValueError, match='packed_indices'):
        packing._sequence_stops(addresses, list(range(513)), {'lat': 20., 'lng': 75.})


@pytest.mark.parametrize('count', [800, 1600])
def test_separated_routes_avoid_quadratic_scalar_distance_work(monkeypatch, count):
    addresses = [{'lat': 19. + (i * .017) % 10, 'lng': 72. + (i * .031) % 10}
                 for i in range(count)]
    indices = list(range(count))
    start = {'lat': 19., 'lng': 72.}
    expected = oracle(addresses, indices, start)
    original = packing._haversine
    calls = 0
    def counted(*args):
        nonlocal calls
        calls += 1
        return original(*args)
    monkeypatch.setattr(packing, '_haversine', counted)
    assert packing._sequence_stops(addresses, indices, start) == expected
    assert calls < 4 * count


def test_public_packing_entrypoint_forwards_depot_into_spatial_path(monkeypatch):
    count = 512
    packages = [{'length': 1., 'width': 1., 'height': 1., 'weight': 1.}
                for _ in range(count)]
    truck = {'length': 512., 'width': 1., 'height': 1., 'max_weight': 1000.}
    addresses = [{'lat': 20. + i / 1000, 'lng': 75.} for i in range(count)]
    start = addresses[-1].copy()
    result = packing.optimise_packing(packages, truck, addresses, start)
    assert result['stop_sequence'] == list(reversed(range(count)))
    assert result['unpacked_packages'] == []
    assert result['utilization_pct'] == 100.
    assert all(item['fits'] for item in result['packing_arrangement'])
