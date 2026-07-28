import json
import os
import pickle
import asyncio
from unittest.mock import patch, AsyncMock

import pytest

from app.models.base import (
    save_model,
    load_model,
    model_exists,
    get_model_path,
    get_meta_path,
    ensure_model_loaded,
    preload_all_models,
)


@pytest.fixture(autouse=True)
def isolate_storage(tmp_path, monkeypatch):
    monkeypatch.setattr("app.models.base.MODEL_STORAGE_DIR", str(tmp_path))
    return tmp_path


class TestGetModelPath:
    def test_returns_pkl_path(self):
        result = get_model_path("my_model")
        assert result.endswith("my_model.pkl")

    def test_creates_directory(self, tmp_path):
        nested = tmp_path / "subdir" / "models"
        with patch("app.models.base.MODEL_STORAGE_DIR", str(nested)):
            get_model_path("x")
            assert nested.exists()


class TestGetMetaPath:
    def test_returns_json_path(self):
        result = get_meta_path("my_model")
        assert result.endswith("my_model_meta.json")

    def test_creates_directory(self, tmp_path):
        nested = tmp_path / "subdir" / "meta"
        with patch("app.models.base.MODEL_STORAGE_DIR", str(nested)):
            get_meta_path("x")
            assert nested.exists()


class TestSaveModel:
    def test_creates_pkl_file(self, tmp_path):
        save_model({"key": "value"}, "test_model")
        pkl = tmp_path / "test_model.pkl"
        assert pkl.exists()

    def test_creates_meta_file(self, tmp_path):
        save_model({"key": "value"}, "test_model")
        meta = tmp_path / "test_model_meta.json"
        assert meta.exists()

    def test_meta_contains_model_name(self, tmp_path):
        save_model({"key": "value"}, "test_model")
        meta = json.loads((tmp_path / "test_model_meta.json").read_text())
        assert meta["model_name"] == "test_model"

    def test_meta_contains_saved_at(self, tmp_path):
        save_model({"key": "value"}, "test_model")
        meta = json.loads((tmp_path / "test_model_meta.json").read_text())
        assert "saved_at" in meta

    def test_meta_contains_metrics(self, tmp_path):
        save_model({"key": "value"}, "test_model", metrics={"r2": 0.95})
        meta = json.loads((tmp_path / "test_model_meta.json").read_text())
        assert meta["metrics"] == {"r2": 0.95}

    def test_meta_metrics_defaults_to_empty_dict(self, tmp_path):
        save_model({"key": "value"}, "test_model")
        meta = json.loads((tmp_path / "test_model_meta.json").read_text())
        assert meta["metrics"] == {}

    def test_pickled_data_is_loadable(self, tmp_path):
        original = {"key": "value", "nested": [1, 2, 3]}
        save_model(original, "test_model")
        with open(tmp_path / "test_model.pkl", "rb") as f:
            loaded = pickle.load(f)
        assert loaded == original

    def test_atomic_write_no_tmp_files_remain(self, tmp_path):
        save_model("data", "atomic_test")
        files = os.listdir(tmp_path)
        assert not any(f.endswith(".tmp") for f in files)


class TestLoadModel:
    def test_loads_saved_model(self):
        save_model({"data": 42}, "load_test")
        result = load_model("load_test")
        assert result == {"data": 42}

    def test_returns_none_for_missing_model(self):
        result = load_model("nonexistent_model_xyz")
        assert result is None

    def test_roundtrip_complex_object(self):
        original = [{"a": 1}, (2, 3), "hello", 42.0]
        save_model(original, "complex_test")
        result = load_model("complex_test")
        assert result == original


class TestModelExists:
    def test_returns_true_when_saved(self, tmp_path):
        save_model("data", "exists_test")
        assert model_exists("exists_test") is True

    def test_returns_false_when_missing(self):
        assert model_exists("no_such_model") is False

    def test_false_after_only_meta_written(self, tmp_path):
        meta_path = get_meta_path("meta_only")
        with open(meta_path, "w") as f:
            json.dump({"model_name": "meta_only"}, f)
        assert model_exists("meta_only") is False


class TestEnsureModelLoaded:
    @pytest.mark.asyncio
    async def test_trains_when_model_missing(self, tmp_path):
        train_fn = AsyncMock()
        result = await ensure_model_loaded("new_model", train_fn)
        train_fn.assert_awaited_once()
        assert result is None

    @pytest.mark.asyncio
    async def test_skips_training_when_model_exists(self):
        save_model("existing_data", "existing_model")
        train_fn = AsyncMock()
        result = await ensure_model_loaded("existing_model", train_fn)
        train_fn.assert_not_awaited()
        assert result == "existing_data"

    @pytest.mark.asyncio
    async def test_training_then_load(self, tmp_path):
        async def train_and_save():
            save_model("trained_data", "train_test")

        result = await ensure_model_loaded("train_test", train_and_save)
        assert result == "trained_data"

    @pytest.mark.asyncio
    async def test_passes_args_to_train_fn(self, tmp_path):
        train_fn = AsyncMock()
        await ensure_model_loaded("args_model", train_fn, "pos1", "pos2", kwarg="val")
        train_fn.assert_awaited_once_with("pos1", "pos2", kwarg="val")

    @pytest.mark.asyncio
    async def test_concurrent_calls_same_model(self):
        call_count = 0

        async def slow_train():
            nonlocal call_count
            call_count += 1
            save_model(f"result_{call_count}", "concurrent_model")

        results = await asyncio.gather(
            ensure_model_loaded("concurrent_model", slow_train),
            ensure_model_loaded("concurrent_model", slow_train),
        )
        assert call_count == 1


class TestPreloadAllModels:
    @pytest.mark.asyncio
    async def test_logs_existing_models(self, tmp_path, caplog):
        save_model("d", "demand_forecast")
        save_model("p", "price_forecast")
        with caplog.at_level("INFO"):
            await preload_all_models()
        assert "demand_forecast" in caplog.text
        assert "price_forecast" in caplog.text

    @pytest.mark.asyncio
    async def test_logs_missing_models(self, caplog):
        with caplog.at_level("INFO"):
            await preload_all_models()
        assert "demand_forecast" in caplog.text
        assert "price_forecast" in caplog.text
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
