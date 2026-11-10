"""Native numerical/publication controls with an independent Decimal oracle."""

from concurrent.futures import ThreadPoolExecutor
from decimal import Decimal, localcontext
from itertools import permutations

import numpy as np
import pytest
from federated.fl_server import FederatedAveragingServer


def update(values, count=1):
    return {"weights": np.asarray(values), "num_samples": count}


def oracle(updates):
    with localcontext() as context:
        context.prec = 2500
        denominator = Decimal(sum(int(c["num_samples"]) for c in updates))
        return np.array(
            [
                float(
                    sum(
                        Decimal.from_float(float(c["weights"][j]))
                        * int(c["num_samples"])
                        for c in updates
                    )
                    / denominator
                )
                for j in range(len(updates[0]["weights"]))
            ]
        )


@pytest.mark.parametrize("clients", [1, 7, 11, 19, 100, 256])
def test_max_finite_convex_mean_never_overflows(clients):
    extreme = np.finfo(float).max
    updates = [update([extreme, -extreme]) for _ in range(clients)]
    result = FederatedAveragingServer(2).aggregate_updates(updates)
    np.testing.assert_array_equal(result, [extreme, -extreme])


@pytest.mark.parametrize("counts", [[1, 1, 1], [10**400, 10**400, 1], [1, 1, 10**400]])
def test_exact_cancellation_and_uneven_sample_counts(counts):
    updates = [
        update([np.finfo(float).max], counts[0]),
        update([-np.finfo(float).max], counts[1]),
        update([1.0], counts[2]),
    ]
    result = FederatedAveragingServer(1).aggregate_updates(updates)
    np.testing.assert_array_equal(result, oracle(updates))


def test_tiny_share_can_contribute_without_early_share_underflow():
    updates = [update([0.0], 10**400), update([np.finfo(float).max], 1)]
    result = FederatedAveragingServer(1).aggregate_updates(updates)
    assert result[0] > 0
    np.testing.assert_array_equal(result, oracle(updates))


def test_subnormal_rounding_matches_independent_oracle():
    tiny = np.nextafter(0.0, 1.0)
    updates = [update([tiny, 3 * tiny]), update([0.0, 2 * tiny])]
    np.testing.assert_array_equal(
        FederatedAveragingServer(2).aggregate_updates(updates), oracle(updates)
    )


def test_permutations_do_not_change_a_published_mean():
    updates = [
        update([1e308, 1.0], 2),
        update([-1e308, 1e-300], 2),
        update([1.0, -1.0], 3),
    ]
    expected = oracle(updates)
    for order in permutations(updates):
        np.testing.assert_array_equal(
            FederatedAveragingServer(2).aggregate_updates(order), expected
        )


def test_seeded_native_binary64_vectors_match_high_precision_means():
    rng = np.random.default_rng(1074)
    for _ in range(80):
        updates = []
        for _ in range(5):
            mantissas = rng.uniform(-1.0, 1.0, 8)
            powers = rng.integers(-1074, 1024, 8)
            values = np.ldexp(mantissas, powers)
            count = int(rng.integers(1, 100000)) * 10 ** int(rng.integers(0, 150))
            updates.append(update(values, count))
        result = FederatedAveragingServer(8).aggregate_updates(updates)
        np.testing.assert_array_equal(result, oracle(updates))
        stacked = np.stack([u["weights"] for u in updates])
        assert np.all(result >= stacked.min(axis=0))
        assert np.all(result <= stacked.max(axis=0))


@pytest.mark.parametrize(
    "bad",
    [
        update([1.0]),
        update([[1.0, 2.0]]),
        update([1.0, 2.0, 3.0]),
        update([float("nan"), 1]),
        update([float("inf"), 1]),
        update([True, False]),
        update(["1", "2"]),
        update([1 + 2j, 1]),
        update([1.0, 2.0], 0),
        update([1.0, 2.0], -1),
        update([1.0, 2.0], True),
        update([1.0, 2.0], 1.5),
        update([1.0, 2.0], "1"),
        update([1.0, 2.0], 1 << 4096),
        {"weights": [1.0, 2.0]},
        {"num_samples": 1},
        None,
    ],
)
def test_bad_later_client_leaves_published_model_unchanged(bad):
    server = FederatedAveragingServer(2)
    server.global_weights = [9.0, 8.0]
    with pytest.raises((ValueError, TypeError)):
        server.aggregate_updates([update([3.0, 4.0]), bad])
    np.testing.assert_array_equal(server.global_weights, [9.0, 8.0])


@pytest.mark.parametrize("width", [0, -1, True, 1.5, 4097])
def test_width_admission(width):
    with pytest.raises(ValueError):
        FederatedAveragingServer(width)


def test_batch_budget_is_checked_before_processing():
    server = FederatedAveragingServer(1)
    with pytest.raises(ValueError, match="budget"):
        server.aggregate_updates([None] * 257)
    np.testing.assert_array_equal(server.global_weights, [0.0])


def test_native_numpy_integer_metadata_is_supported():
    server = FederatedAveragingServer(np.int64(2))
    np.testing.assert_array_equal(
        server.aggregate_updates([update([1.0, 2.0], np.int64(3))]), [1.0, 2.0]
    )


def test_inputs_results_reads_and_empty_batches_cannot_mutate_published_state():
    server = FederatedAveragingServer(2)
    original = np.array([1.0, 2.0])
    result = server.aggregate_updates([update(original)])
    original[:] = 99
    result[:] = 88
    snapshot = server.global_weights
    snapshot[:] = 77
    empty = server.aggregate_updates([])
    empty[:] = 66
    np.testing.assert_array_equal(server.global_weights, [1.0, 2.0])
    assert not np.shares_memory(result, server.global_weights)


def test_legacy_setter_admits_owned_model_or_preserves_old_state():
    server = FederatedAveragingServer(2)
    external = np.array([3.0, 4.0])
    server.global_weights = external
    external[:] = 99
    np.testing.assert_array_equal(server.global_weights, [3.0, 4.0])
    with pytest.raises(ValueError):
        server.global_weights = [float("nan"), 1.0]
    np.testing.assert_array_equal(server.global_weights, [3.0, 4.0])


def test_concurrent_readers_only_observe_complete_native_models():
    server = FederatedAveragingServer(128)

    def write(value):
        for _ in range(20):
            server.aggregate_updates([update(np.full(128, value))])

    with ThreadPoolExecutor(max_workers=3) as executor:
        writers = [executor.submit(write, float(i)) for i in (1, 2)]
        for _ in range(200):
            observed = server.global_weights
            assert np.all(observed == observed[0])
        for future in writers:
            future.result(timeout=10)
