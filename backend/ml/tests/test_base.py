import os
import json
import pytest
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.models.base import (
    SUPPORTED_MODELS,
    model_exists,
    save_model,
    load_model,
    check_models_exist,
    preload_all_models,
    get_model_path,
)


# ---------------------------------------------------------------------------
# SUPPORTED_MODELS constant
# ---------------------------------------------------------------------------


def test_supported_models_contains_all_persistent_models():
    expected = {
        "demand_forecast",
        "price_forecast",
        "driver_profit",
        "trust_scorer",
        "collaborative_filter",
    }
    assert set(SUPPORTED_MODELS) == expected


def test_supported_models_is_not_empty():
    assert len(SUPPORTED_MODELS) >= 5


# ---------------------------------------------------------------------------
# model_exists / save_model / load_model round-trip
# ---------------------------------------------------------------------------


def test_model_exists_returns_false_for_missing(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    assert model_exists("nonexistent_model_xyz") is False


def test_save_and_load_roundtrip(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    dummy = {"weights": [1.0, 2.0, 3.0], "bias": 0.5}
    save_model(dummy, "test_roundtrip")
    assert model_exists("test_roundtrip") is True
    loaded = load_model("test_roundtrip")
    assert loaded == dummy


def test_load_nonexistent_returns_none(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    assert load_model("does_not_exist") is None


def test_save_model_writes_metadata(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    save_model({"x": 1}, "meta_test", metrics={"r2": 0.95})
    meta_path = os.path.join(str(tmp_path), "meta_test_meta.json")
    assert os.path.exists(meta_path)
    with open(meta_path) as f:
        meta = json.load(f)
    assert meta["model_name"] == "meta_test"
    assert meta["metrics"] == {"r2": 0.95}
    assert "saved_at" in meta


def test_get_model_path_ends_with_pkl(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    path = get_model_path("my_model")
    assert path.endswith("my_model.pkl")


def test_save_model_atomic_write(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    save_model({"val": 42}, "atomic_test")
    tmp_files = [f for f in os.listdir(str(tmp_path)) if f.endswith(".tmp")]
    assert len(tmp_files) == 0, "No .tmp files should remain after atomic write"


# ---------------------------------------------------------------------------
# check_models_exist
# ---------------------------------------------------------------------------


def test_check_models_exist_returns_set(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    result = check_models_exist()
    assert isinstance(result, set)
    assert len(result) == 0


def test_check_models_exist_includes_saved(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    save_model("dummy", "demand_forecast")
    save_model("dummy", "driver_profit")
    result = check_models_exist()
    assert "demand_forecast" in result
    assert "driver_profit" in result
    assert "trust_scorer" not in result


# ---------------------------------------------------------------------------
# preload_all_models
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_preload_all_models_returns_empty_when_no_models(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    result = await preload_all_models()
    assert isinstance(result, set)
    assert len(result) == 0


@pytest.mark.asyncio
async def test_preload_all_models_returns_available(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    save_model("dummy", "demand_forecast")
    save_model("dummy", "price_forecast")
    save_model("dummy", "trust_scorer")
    result = await preload_all_models()
    assert result == {"demand_forecast", "price_forecast", "trust_scorer"}


@pytest.mark.asyncio
async def test_preload_all_models_checks_all_supported(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    for name in SUPPORTED_MODELS:
        save_model("dummy", name)
    result = await preload_all_models()
    assert result == set(SUPPORTED_MODELS)


@pytest.mark.asyncio
async def test_preload_all_models_returns_set_type(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    result = await preload_all_models()
    assert isinstance(result, set)
