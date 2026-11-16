"""Native per-call random streams and frozen serial compatibility oracle."""

import importlib.util
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np
import pytest
from app.models import collaborative_filter as collaborative
from app.models import demand_forecast as demand
from app.models import driver_profit as profit
from app.models import eta_prediction as eta
from app.models import trust_scorer as trust

GENERATORS = {
    "eta": lambda n=32: eta.ETAPredictor().generate_synthetic_data(n),
    "demand": demand.generate_synthetic_demand_data,
    "profit": profit._generate_synthetic_data,
    "collaborative": lambda n=32: collaborative._generate_synthetic_data(),
    "trust": trust.generate_synthetic_trust_data,
}
spec = importlib.util.spec_from_file_location(
    "rng_legacy",
    Path(__file__).resolve().parents[3]
    / "tools/training-rng-tests/legacy_generators.py",
)
legacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(legacy)


def assert_equal(actual, expected):
    if isinstance(expected, np.ndarray):
        np.testing.assert_array_equal(actual, expected)
    elif isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            assert_equal(actual[key], expected[key])
    elif isinstance(expected, (list, tuple)):
        assert len(actual) == len(expected)
        for a, e in zip(actual, expected, strict=True):
            assert_equal(a, e)
    else:
        assert actual == expected


@pytest.fixture(autouse=True)
def preserve_global_stream():
    state = np.random.get_state()
    yield
    np.random.set_state(state)


@pytest.mark.parametrize("name", GENERATORS)
@pytest.mark.parametrize("size", [3, 32])
def test_serial_seed42_arrays_and_ids_are_exactly_compatible(name, size):
    oracle = getattr(legacy, "legacy_" + name)
    expected = (
        oracle(None, size)
        if name == "eta"
        else oracle()
        if name == "collaborative"
        else oracle(size)
    )
    assert_equal(GENERATORS[name](size), expected)


@pytest.mark.parametrize("name", GENERATORS)
def test_generation_does_not_reseed_or_consume_global_stream(name):
    np.random.seed(1907)
    state = np.random.get_state()
    expected = np.random.random(20)
    np.random.set_state(state)
    GENERATORS[name](32)
    np.testing.assert_array_equal(np.random.random(20), expected)


class DrawBoundary:
    """Wrap real NumPy draws; pause exactly one owner after its first draw."""

    def __init__(self, native, entered, release, fired):
        self.native, self.entered, self.release, self.fired = (
            native,
            entered,
            release,
            fired,
        )

    def __getattr__(self, name):
        attr = getattr(self.native, name)
        if name == "RandomState":
            return lambda *args, **kwargs: DrawBoundary(
                attr(*args, **kwargs), self.entered, self.release, self.fired
            )
        if name in {"seed", "get_state", "set_state"} or not callable(attr):
            return attr

        def draw(*args, **kwargs):
            result = attr(*args, **kwargs)
            if (
                threading.current_thread().name.startswith("rng-owner")
                and not self.fired
            ):
                self.fired.append(True)
                self.entered.set()
                assert self.release.wait(3), "owner draw was not released"
            return result

        return draw


@pytest.mark.parametrize("name", GENERATORS)
@pytest.mark.parametrize("interference", ["same_model", "other_model", "global_draws"])
def test_native_training_interleavings_are_invocation_owned(
    monkeypatch, name, interference
):
    expected = GENERATORS[name](32)
    entered, release, fired = threading.Event(), threading.Event(), []
    native = np.random
    monkeypatch.setattr(np, "random", DrawBoundary(native, entered, release, fired))
    with ThreadPoolExecutor(1, thread_name_prefix="rng-owner") as pool:
        owner = pool.submit(GENERATORS[name], 32)
        try:
            assert entered.wait(3)
            if interference == "same_model":
                GENERATORS[name](37)
            elif interference == "other_model":
                GENERATORS["profit" if name == "demand" else "demand"](37)
            else:
                native.seed(709)
                native.random(100)
        finally:
            release.set()
        assert_equal(owner.result(timeout=3), expected)
