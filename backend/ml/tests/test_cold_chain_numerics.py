"""Actual-source numerical and router regressions; no provider connections."""

import importlib.util
import json
import math
import sys
import types
from decimal import Decimal, localcontext
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]


def load_source(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


service = load_source("cold_chain_native", ROOT / "services/cold_chain_anomaly.py")


def reference_mkt(values):
    # Independently evaluate the untransformed formula at 400 decimal digits.
    with localcontext() as ctx:
        ctx.prec = 400
        kelvin = [
            Decimal.from_float(float(t)) + Decimal.from_float(273.15) for t in values
        ]
        average = sum((-Decimal(10000) / t).exp() for t in kelvin) / len(kelvin)
        return float(Decimal(10000) / -average.ln() - Decimal.from_float(273.15))


@pytest.mark.parametrize(
    "values",
    [
        [4.0, 8.0, 2.0],
        [-260.0],
        [-270.0, -260.0],
        [-260.0, 4.0],
        [1e25],
        [1e25, 2e25],
        [1e308, 5e307],
        [4.0, 1e308],
        [0.0, 40.0, 100.0],
        [-250.0, -200.0, 30000.0],
    ],
)
def test_mkt_matches_independent_decimal_formula(values):
    actual = service.calculate_mean_kinetic_temperature(values)
    expected = round(reference_mkt(values), 2)
    assert math.isfinite(actual)
    assert actual == pytest.approx(expected, rel=2e-14, abs=0.011)


@pytest.mark.parametrize(
    "temperature", [math.nextafter(-273.15, math.inf), 0.0, 1e25, sys.float_info.max]
)
def test_singleton_and_duplicate_identity(temperature):
    expected = round(temperature, 2)
    assert service.calculate_mean_kinetic_temperature([temperature]) == pytest.approx(
        expected
    )
    assert service.calculate_mean_kinetic_temperature(
        [temperature] * 20
    ) == pytest.approx(expected)


@pytest.mark.parametrize(
    "bad",
    [
        None,
        True,
        "4",
        float("nan"),
        float("inf"),
        -float("inf"),
        -273.15,
        -300.0,
        10**400,
    ],
)
def test_complete_temperature_window_rejects_invalid_observation(bad):
    with pytest.raises(ValueError):
        service.calculate_mean_kinetic_temperature([4.0, bad])
    with pytest.raises(ValueError):
        service.evaluate_cargo_integrity([4.0, bad], 2.0, 8.0)


def test_empty_estimate_is_missing_but_empty_assessment_is_not_normal():
    assert service.calculate_mean_kinetic_temperature([]) is None
    with pytest.raises(ValueError):
        service.evaluate_cargo_integrity([], 2.0, 8.0)


@pytest.mark.parametrize(
    "values", [[1e308, 1e308], [1e308, 0.0], [1e-200, -1e-200], [0.0, -3.0, 4.0], []]
)
def test_scaled_rms_matches_decimal(values):
    with localcontext() as ctx:
        ctx.prec = 400
        expected = (
            float(
                (sum(Decimal.from_float(x) ** 2 for x in values) / len(values)).sqrt()
            )
            if values
            else 0.0
        )
    result = service.evaluate_shock_vibration(values)
    assert result["rms_vibration_g"] == pytest.approx(round(expected, 2), rel=2e-14)
    assert result["breach_count"] == sum(abs(x) > 3.5 for x in values)
    json.dumps(result, allow_nan=False)


@pytest.mark.parametrize("bad", [True, None, "3", float("inf"), float("nan")])
def test_shock_window_rejects_invalid_sample(bad):
    with pytest.raises(ValueError):
        service.evaluate_shock_vibration([1.0, bad])


@pytest.mark.parametrize(
    "policy",
    [
        {"min_temp": 9.0, "max_temp": 8.0},
        {"min_temp": -273.15},
        {"max_temp": float("inf")},
        {"sample_interval_mins": 0.0},
        {"sample_interval_mins": float("nan")},
        {"max_allowed_excursion_mins": -1},
        {"door_open_events": -1},
        {"door_open_events": True},
        {"door_open_events": 1.5},
    ],
)
def test_policy_admission_precedes_classification(policy):
    args = {"min_temp": 2.0, "max_temp": 8.0, **policy}
    with pytest.raises(ValueError):
        service.evaluate_cargo_integrity([4.0], **args)


def test_extreme_duration_rejects_overflow_but_finite_warning_serializes():
    with pytest.raises(ValueError):
        service.evaluate_cargo_integrity(
            [20.0, 20.0], 2.0, 8.0, sample_interval_mins=1e308
        )
    result = service.evaluate_cargo_integrity(
        [9.0], 2.0, 8.0, sample_interval_mins=1e308, max_allowed_excursion_mins=1.7e308
    )
    assert result["status"] == "WARNING"
    assert result["quality_score"] == 50
    json.dumps(result, allow_nan=False)


def test_normal_breach_and_zero_allowance_business_thresholds():
    normal = service.evaluate_cargo_integrity([4.0, 4.0], 2.0, 8.0)
    assert normal["status"] == "NORMAL" and normal["quality_score"] == 100
    critical = service.evaluate_cargo_integrity(
        [9.0], 2.0, 8.0, max_allowed_excursion_mins=0
    )
    assert (
        critical["temp_breach"] is True and critical["status"] == "CRITICAL_SLA_BREACH"
    )
    boundary = service.evaluate_shock_vibration([3.5])
    assert boundary["shock_breach"] is False


@pytest.fixture
def client(monkeypatch):
    # Bypass only unrelated services.__init__ startup; use the real service/router.
    package = types.ModuleType("services")
    package.__path__ = [str(ROOT / "services")]
    monkeypatch.setitem(sys.modules, "services", package)
    monkeypatch.setitem(sys.modules, "services.cold_chain_anomaly", service)
    route = load_source(
        "cold_chain_router_native", ROOT / "routes/cold_chain_routes.py"
    )
    app = FastAPI()
    app.include_router(route.router)
    with TestClient(app) as result:
        yield result


def test_actual_mkt_route_handles_cold_and_hot(client):
    for value in [-260.0, 1e25]:
        response = client.post("/coldchain/mkt", json={"temperatures_celsius": [value]})
        assert response.status_code == 200
        assert response.json()["mkt_celsius"] == pytest.approx(value)
    assert (
        client.post("/coldchain/mkt", json={"temperatures_celsius": []}).json()[
            "mkt_celsius"
        ]
        is None
    )


def test_actual_evaluate_route_preserves_zero_and_finite_shock(client):
    response = client.post(
        "/coldchain/evaluate",
        json={
            "load_id": "native",
            "temperatures_celsius": [9.0],
            "max_allowed_excursion_mins": 0,
            "shock_readings_g": [1e308, 1e308],
        },
    )
    assert response.status_code == 200
    result = response.json()["data"]
    assert result["temp_breach"] is True and result["max_allowed_excursion_mins"] == 0
    assert math.isfinite(result["shock_analysis"]["rms_vibration_g"])


@pytest.mark.parametrize(
    "patch",
    [
        {"temperatures_celsius": [-300.0]},
        {"temperatures_celsius": []},
        {"sample_interval_mins": 0},
        {"min_temp_celsius": 9},
        {"door_open_events": -1},
        {"temperatures_celsius": [True]},
        {"shock_readings_g": [False]},
    ],
)
def test_actual_router_client_errors(client, patch):
    response = client.post(
        "/coldchain/evaluate",
        json={
            "load_id": "native",
            "temperatures_celsius": [4.0],
            **patch,
        },
    )
    assert response.status_code in (400, 422)


def test_route_legacy_null_options_use_defaults(client):
    response = client.post(
        "/coldchain/evaluate",
        json={
            "load_id": "native",
            "temperatures_celsius": [4.0],
            "sample_interval_mins": None,
            "max_allowed_excursion_mins": None,
            "door_open_events": None,
        },
    )
    assert response.status_code == 200
    assert response.json()["data"]["status"] == "NORMAL"
