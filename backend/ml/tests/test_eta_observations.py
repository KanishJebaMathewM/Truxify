"""Native learned inference and independent temporal-publication witnesses."""
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import numpy as np
import pytest
from services._eta_inference_off_event_loop_patch import (
    _get_predict_eta_lock,
    _run_serialized_predict_eta,
)
from services.traffic_pipeline import TrafficPipeline
from tensorflow import keras


@pytest.fixture(scope="module")
def learned():
    model = keras.Sequential([
        keras.layers.Input((60, 5)),
        keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dense(1, kernel_initializer="ones", bias_initializer="zeros"),
    ])
    model.compile(optimizer=keras.optimizers.SGD(0.001), loss="mse")
    model.train_on_batch(np.ones((4, 60, 5)), np.full((4, 1), 2.0))
    return model


def pipeline(model, capacity=2):
    result = object.__new__(TrafficPipeline)
    result.model = model
    result._route_windows = OrderedDict()
    result._max_route_windows = capacity
    result._last_route_history_metrics = {
        "route_id": None, "route_signature": None, "route_key": None,
    }
    return result


def snapshot(p):
    return (
        [(k, [r.tolist() for r in v]) for k, v in p._route_windows.items()],
        p.get_route_history_metrics(),
    )


def test_learned_sequence_matches_independent_padding_and_owned_rows(learned):
    p = pipeline(learned)
    a = np.array([1., 2., 3., 4., 5.])
    b = np.array([6., 7., 8., 9., 10.])
    p.predict_eta(a, "r", "v")
    a[:] = 999
    result = p.predict_eta(b.reshape(1, 5), "r", "v")
    kernel, bias = learned.get_weights()
    means = (59 * np.arange(1., 6.) + np.arange(6., 11.)) / 60
    expected = float(means @ kernel[:, 0] + bias[0])
    assert result == pytest.approx(expected, abs=1e-5)
    b[:] = 888
    np.testing.assert_array_equal(p._route_windows["r:v"][0], np.arange(1., 6.))
    np.testing.assert_array_equal(p._route_windows["r:v"][1], np.arange(6., 11.))
    assert not np.shares_memory(a, p._route_windows["r:v"][0])


@pytest.mark.parametrize("bad", [
    np.full(5, 1 + 2j), np.ones((2, 5)), np.ones((1, 1, 5)), np.ones(4), np.ones(6),
    np.array([]), np.ones((0, 5)), np.array(["bad"] * 5),
    np.full(5, np.nan), np.full(5, np.inf), np.full(5, -np.inf),
    np.array([1, 2, None, 4, 5], dtype=object),
])
def test_rejected_complete_input_preserves_lru_rows_metrics(learned, bad):
    p = pipeline(learned)
    p.predict_eta(np.ones(5), "a")
    p.predict_eta(np.full(5, 2), "b")
    before = snapshot(p)
    assert p.predict_eta(bad, "c") is None
    assert snapshot(p) == before


def test_native_failure_preserves_existing_and_new_routes(learned):
    p = pipeline(learned)
    p.predict_eta(np.ones(5), "a")
    p.predict_eta(np.full(5, 2), "b")
    before = snapshot(p)

    class FailedNativeResult:
        def predict(self, x, verbose=0):
            learned.predict(x, verbose=verbose)
            x[:] = 999  # Native input is private, including previous rows.
            raise RuntimeError("injected failure after actual native inference")

    p.model = FailedNativeResult()
    for route in ["a", "c"]:
        assert p.predict_eta(np.full(5, 3), route) is None
        assert snapshot(p) == before


def test_actual_nonfinite_native_result_preserves_state(learned):
    p = pipeline(learned)
    p.predict_eta(np.ones(5), "a")
    before = snapshot(p)
    bad = keras.Sequential([
        keras.layers.Input((60, 5)), keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dense(1),
    ])
    bad.layers[-1].set_weights([np.full((5, 1), np.nan), np.zeros(1)])
    p.model = bad
    assert p.predict_eta(np.ones(5), "b") is None
    assert snapshot(p) == before


def test_actual_multivalue_native_output_is_rejected(learned):
    p = pipeline(learned)
    before = snapshot(p)
    p.model = keras.Sequential([
        keras.layers.Input((60, 5)), keras.layers.GlobalAveragePooling1D(),
        keras.layers.Dense(2),
    ])
    assert p.predict_eta(np.ones(5), "a") is None
    assert snapshot(p) == before


@pytest.mark.parametrize("realtime", [False, True])
def test_direct_and_realtime_share_owner_and_exclude_failed_predecessor(learned, realtime):
    entered, release, successor_started, successor_native = (
        threading.Event() for _ in range(4)
    )
    class ControlledNative:
        def predict(self, x, verbose=0):
            result = learned.predict(x, verbose=verbose)
            if x[0, -1, 0] == 1:
                entered.set()
                assert release.wait(10)
                raise RuntimeError("injected result failure")
            successor_native.set()
            return result

    p = pipeline(ControlledNative())
    def successor():
        successor_started.set()
        if realtime:
            return _run_serialized_predict_eta(p, np.full(5, 2), "r", None)
        return p.predict_eta(np.full(5, 2), "r")

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(p.predict_eta, np.ones(5), "r")
        assert entered.wait(10)
        second = pool.submit(successor)
        assert successor_started.wait(10)
        # The native predecessor owns admission until it rejects its result.
        assert not successor_native.wait(0.1)
        release.set()
        assert first.result(timeout=10) is None
        assert np.isfinite(second.result(timeout=10))
    assert len(p._route_windows["r"]) == 1
    np.testing.assert_array_equal(p._route_windows["r"][0], np.full(5, 2))
    assert _get_predict_eta_lock(p) is p._eta_predict_lock


def test_successful_only_lru_and_60_step_eviction(learned):
    p = pipeline(learned)
    for key in ["a", "b", "a", "c"]:
        assert np.isfinite(p.predict_eta(np.ones(5), key))
    assert list(p._route_windows) == ["a", "c"]
    # Use preparation alone for long-window geometry; native final scoring remains real.
    from services._eta_observations import prepare_window
    window = None
    for i in range(65):
        window, model_input = prepare_window(np.full(5, i), window)
    assert len(window) == 60
    np.testing.assert_array_equal(model_input[0, :, 0], np.arange(5, 65))
    assert np.isfinite(learned.predict(model_input, verbose=0)).all()


def test_independent_metric_view_and_disabled_model(learned):
    p = pipeline(learned)
    p.predict_eta(np.ones(5), "a", "destination")
    view = p.get_route_history_metrics()
    view["route_key"] = "changed"
    before = snapshot(p)
    p.model = None
    assert p.predict_eta(np.ones(5), "b") is None
    assert snapshot(p) == before


@pytest.mark.asyncio
async def test_mounted_predict_uses_native_owned_commit(learned, monkeypatch):
    import importlib
    from types import SimpleNamespace
    from unittest.mock import AsyncMock

    import httpx
    from fastapi import FastAPI

    with monkeypatch.context() as setup:
        setup.setattr(TrafficPipeline, "__init__", lambda self, *args: None)
        routes = importlib.import_module("routes.eta_routes")
    p = pipeline(learned)
    p.ingest_traffic_data = AsyncMock(return_value=SimpleNamespace(
        traffic_speed=20., free_flow_speed=25., congestion_level=0.2,
    ))
    p._fetch_osrm_data = AsyncMock(return_value={"distance": 2000., "duration": 100.})
    monkeypatch.setattr(routes, "traffic_pipeline", p)
    monkeypatch.setattr(routes, "_get_order_route", lambda _: {
        "source_lat": 10., "source_lng": 20., "dest_lat": 11., "dest_lng": 21.,
    })
    app = FastAPI()
    app.include_router(routes.router)
    app.dependency_overrides[routes.verify_api_key] = lambda: None
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://local",
    ) as client:
        response = await client.post("/eta/predict", json={
            "order_id": "owned", "source_lat": 10, "source_lng": 20,
            "dest_lat": 11, "dest_lng": 21,
        })
    assert response.status_code == 200
    assert np.isfinite(response.json()["eta_seconds"])
    assert len(p._route_windows) == 1
    assert next(iter(p._route_windows.values()))[0][0] == 20
    assert p.get_route_history_metrics()["route_id"] == "order_owned"
