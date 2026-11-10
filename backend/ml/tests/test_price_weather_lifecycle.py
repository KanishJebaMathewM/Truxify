"""Provider-boundary tests: real cache ownership, no external weather requests."""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from threading import Event
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
from app.models import price_prediction as weather


@pytest.fixture(autouse=True)
def clean_cache(monkeypatch):
    weather.reset_weather_cache()
    monkeypatch.setattr(weather, "ML_WEATHER_MAX_INFLIGHT", 4, raising=False)
    monkeypatch.setattr(weather, "ML_WEATHER_COALESCE_WAIT_SECONDS", 2, raising=False)
    yield
    assert not getattr(weather, "_WEATHER_FLIGHTS", {})
    weather.reset_weather_cache()


def blocked_provider(monkeypatch, result=(1.2, True), error=None):
    entered, release = Event(), Event()
    calls = []

    def fetch(city):
        calls.append(city)
        entered.set()
        assert release.wait(5), "test failed to release provider"
        if error:
            raise error
        return result

    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http", fetch)
    return entered, release, calls


def observe_follower(city):
    """Signal that a real caller has reached its completion wait."""
    flight = weather._WEATHER_FLIGHTS[city]
    waiting = Event()
    original = flight.done.wait

    def wait(timeout):
        waiting.set()
        return original(timeout)

    flight.done.wait = wait
    return waiting


@pytest.mark.parametrize("result", [(1.2, True), (1.1, True), (1.0, True), (1.0, False)])
def test_same_city_shares_provider_result(monkeypatch, result):
    entered, release, calls = blocked_provider(monkeypatch, result)
    with ThreadPoolExecutor(2) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        assert entered.wait(3)
        waiting = observe_follower("Delhi")
        follower = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert waiting.wait(3)
            assert calls == ["Delhi"]
        finally:
            release.set()
        assert owner.result() == follower.result() == result[0]
    assert weather._get_weather_multiplier("Delhi") == result[0]
    assert calls == ["Delhi"]


def test_follower_timeout_retains_owner_and_capacity(monkeypatch):
    entered, release, calls = blocked_provider(monkeypatch)
    monkeypatch.setattr(weather, "ML_WEATHER_MAX_INFLIGHT", 1)
    monkeypatch.setattr(weather, "ML_WEATHER_COALESCE_WAIT_SECONDS", 0)
    with ThreadPoolExecutor(1) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert entered.wait(3)
            assert weather._get_weather_multiplier("Delhi") == 1.0
            assert weather._get_weather_multiplier("Mumbai") == 1.0
            assert calls == ["Delhi"]
            assert len(weather._WEATHER_FLIGHTS) == 1
        finally:
            release.set()
        assert owner.result() == 1.2
    assert weather._get_weather_multiplier("Mumbai") == 1.2
    assert calls == ["Delhi", "Mumbai"]


def test_reset_fences_publication_and_preserves_native_owner(monkeypatch):
    entered, release, calls = blocked_provider(monkeypatch)
    monkeypatch.setattr(weather, "ML_WEATHER_MAX_INFLIGHT", 1)
    with ThreadPoolExecutor(1) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert entered.wait(3)
            weather.reset_weather_cache()
            assert weather._get_weather_multiplier("Delhi") == 1.0
            assert weather._get_weather_multiplier("Mumbai") == 1.0
            assert len(weather._WEATHER_FLIGHTS) == 1
            assert calls == ["Delhi"]
        finally:
            release.set()
        assert owner.result() == 1.2
    assert weather._cached_weather_multiplier("Delhi") is None
    assert weather._get_weather_multiplier("Delhi") == 1.2
    assert calls == ["Delhi", "Delhi"]


def test_unrelated_city_progresses_while_owner_blocked(monkeypatch):
    entered, release, calls = blocked_provider(monkeypatch)
    original = weather._fetch_weather_multiplier_http
    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http",
                        lambda city: original(city) if city == "Delhi" else (1.1, True))
    with ThreadPoolExecutor(1) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert entered.wait(3)
            assert weather._get_weather_multiplier("Mumbai") == 1.1
            assert calls == ["Delhi"]
        finally:
            release.set()
        assert owner.result() == 1.2


def test_unexpected_error_releases_followers_and_retry(monkeypatch):
    entered, release, _ = blocked_provider(monkeypatch, error=RuntimeError("offline"))
    clock = [100.0]
    monkeypatch.setattr(weather, "_now", lambda: clock[0])
    with ThreadPoolExecutor(2) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        assert entered.wait(3)
        waiting = observe_follower("Delhi")
        follower = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert waiting.wait(3)
        finally:
            release.set()
        assert owner.result() == follower.result() == 1.0
    clock[0] += weather.ML_WEATHER_FAILURE_TTL_SECONDS + 1
    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http", lambda city: (1.2, True))
    assert weather._get_weather_multiplier("Delhi") == 1.2


@pytest.mark.parametrize("ok,ttl", [(True, "ML_WEATHER_CACHE_TTL_SECONDS"),
                                  (False, "ML_WEATHER_FAILURE_TTL_SECONDS")])
def test_neutral_success_and_failure_keep_distinct_ttls(monkeypatch, ok, ttl):
    clock = [0.0]
    calls = []
    monkeypatch.setattr(weather, "_now", lambda: clock[0])
    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http",
                        lambda city: (calls.append(city) or 1.0, ok))
    assert weather._get_weather_multiplier("Delhi") == 1.0
    clock[0] = getattr(weather, ttl)
    assert weather._get_weather_multiplier("Delhi") == 1.0
    assert len(calls) == 1
    clock[0] += 0.01
    assert weather._get_weather_multiplier("Delhi") == 1.0
    assert len(calls) == 2


@pytest.mark.parametrize("fail", [False, True])
def test_async_fetch_cannot_repopulate_reset_generation(monkeypatch, fail):
    monkeypatch.setenv("OPENWEATHERMAP_API_KEY", "test-only")

    async def scenario():
        entered, release = asyncio.Event(), asyncio.Event()

        async def get(*args, **kwargs):
            entered.set()
            await release.wait()
            if fail:
                raise RuntimeError("offline")
            return httpx.Response(200, json={"weather": [{"main": "Rain"}]})

        task = asyncio.create_task(weather._get_weather_multiplier_async(
            SimpleNamespace(get=get), "Delhi"))
        await entered.wait()
        weather.reset_weather_cache()
        release.set()
        assert await task == (1.0 if fail else 1.2)
        assert weather._cached_weather_multiplier("Delhi") is None

    asyncio.run(scenario())


def test_actual_price_predictions_share_weather_and_preserve_price_formula(monkeypatch):
    entered, release, calls = blocked_provider(monkeypatch)
    model = SimpleNamespace(predict=lambda features: np.array([1000.0]))
    scaler = SimpleNamespace(transform=lambda features: features)
    artifact = (model, scaler, {"delhi": 0})
    if hasattr(weather, "load_model_snapshot"):
        # Keep the weather seam compatible with paired consumer reads (#16937).
        monkeypatch.setattr(weather, "load_model_snapshot", lambda name:
            SimpleNamespace(model=artifact, metadata={"metrics": {"is_real_model": True}}))
    else:
        monkeypatch.setattr(weather, "_model_is_real", lambda: True)
        monkeypatch.setattr(weather, "load_model", lambda name: artifact)

    def predict():
        return weather.predict_price(100, 1000, route_origin="Delhi", route_destination="Delhi")

    with ThreadPoolExecutor(2) as pool:
        owner = pool.submit(predict)
        assert entered.wait(3)
        waiting = observe_follower(calls[0])
        follower = pool.submit(predict)
        try:
            assert waiting.wait(3)
            assert len(calls) == 1
        finally:
            release.set()
        expected = {"estimated_price": 1200.0, "min_price": 1020.0,
                    "max_price": 1380.0, "currency": "INR"}
        assert owner.result() == follower.result() == expected
    assert len(calls) == 1


@pytest.mark.parametrize("value,expected", [("nan", 4), ("inf", 4), ("bad", 4),
                                           ("0", 4), ("-2", 4), ("999", 32), ("8", 8)])
def test_admission_settings_are_finite_positive_and_bounded(monkeypatch, value, expected):
    monkeypatch.setenv("TEST_WEATHER_LIMIT", value)
    assert weather._bounded_weather_setting("TEST_WEATHER_LIMIT", 4, 32) == expected


def test_cache_stays_bounded_and_empty_city_skips_provider(monkeypatch):
    monkeypatch.setattr(weather, "ML_WEATHER_CACHE_MAX_ENTRIES", 2)
    calls = []
    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http",
                        lambda city: (calls.append(city) or 1.2, True))
    assert weather._get_weather_multiplier("") == 1.0
    for city in ("a", "b", "c"):
        assert weather._get_weather_multiplier(city) == 1.2
    assert list(weather._WEATHER_CACHE) == ["b", "c"]
    assert calls == ["a", "b", "c"]


def test_public_sync_result_is_not_cached_after_reset(monkeypatch):
    entered, release, _ = blocked_provider(monkeypatch)
    with ThreadPoolExecutor(1) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        try:
            assert entered.wait(3)
            weather.reset_weather_cache()
        finally:
            release.set()
        assert owner.result() == 1.2
    assert weather._cached_weather_multiplier("Delhi") is None


def test_public_concurrent_lookup_never_dispatches_second_provider(monkeypatch):
    entered, release, _ = blocked_provider(monkeypatch)
    original = weather._fetch_weather_multiplier_http
    calls = []
    second_started = Event()

    def fetch(city):
        calls.append(city)
        return original(city) if len(calls) == 1 else (1.1, True)

    def follower():
        second_started.set()
        return weather._get_weather_multiplier("Delhi")

    monkeypatch.setattr(weather, "_fetch_weather_multiplier_http", fetch)
    with ThreadPoolExecutor(2) as pool:
        owner = pool.submit(weather._get_weather_multiplier, "Delhi")
        assert entered.wait(3)
        second = pool.submit(follower)
        try:
            assert second_started.wait(3)
            with pytest.raises(TimeoutError):
                second.result(timeout=0.1)
            assert calls == ["Delhi"]
        finally:
            release.set()
        assert owner.result() == second.result() == 1.2
