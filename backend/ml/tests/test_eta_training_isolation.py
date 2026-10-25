import asyncio
import importlib
import sys
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from app import execution
from services.traffic_pipeline import TrafficPipeline


async def wait_for_release(model_name):
    for _ in range(100):
        if model_name not in execution._active_training_models:
            return
        await asyncio.sleep(0.01)
    pytest.fail("training admission was not released")


def test_training_does_not_occupy_inference_capacity():
    started, release = threading.Event(), threading.Event()

    def train():
        started.set()
        assert release.wait(2)

    async def scenario():
        job = asyncio.create_task(execution.run_training_job("eta-isolation", train))
        try:
            assert await asyncio.to_thread(started.wait, 1)
            assert await asyncio.wait_for(execution.run_inference(lambda: 42), 0.5) == 42
        finally:
            release.set()
            await job

    asyncio.run(scenario())


def test_training_admission_rejects_duplicates_and_overload(monkeypatch):
    monkeypatch.setattr(execution, "ML_TRAINING_MAX_WORKERS", 1)
    started, release = threading.Event(), threading.Event()

    def train():
        started.set()
        assert release.wait(2)

    async def scenario():
        job = asyncio.create_task(execution.run_training_job("eta-admission", train))
        try:
            assert await asyncio.to_thread(started.wait, 1)
            with pytest.raises(HTTPException) as duplicate:
                await execution.run_training_job("eta-admission", lambda: None)
            assert duplicate.value.status_code == 409
            with pytest.raises(HTTPException) as overload:
                await execution.run_training_job("other-model", lambda: None)
            assert overload.value.status_code == 503
        finally:
            release.set()
            await job
        assert await execution.run_training_job("eta-admission", lambda: "ok") == "ok"

    asyncio.run(scenario())


@pytest.mark.parametrize("cancel_request", [False, True])
def test_timeout_or_disconnect_keeps_admission_until_worker_exits(cancel_request):
    started, release = threading.Event(), threading.Event()
    cancelled = []

    def train():
        started.set()
        assert release.wait(2)
        cancelled.append(execution.is_training_cancelled())

    async def scenario():
        job = asyncio.create_task(execution.run_training_job("eta-timeout", train, timeout=0.1))
        try:
            assert await asyncio.to_thread(started.wait, 1)
            if cancel_request:
                job.cancel()
            with pytest.raises(asyncio.CancelledError if cancel_request else asyncio.TimeoutError):
                await job
            with pytest.raises(HTTPException) as duplicate:
                await execution.run_training_job("eta-timeout", lambda: None)
            assert duplicate.value.status_code == 409
        finally:
            release.set()
            await wait_for_release("eta-timeout")
        assert cancelled == [True]

    asyncio.run(scenario())


def test_failed_training_releases_admission():
    def fail():
        raise ValueError("training failed")

    async def scenario():
        with pytest.raises(ValueError, match="training failed"):
            await execution.run_training_job("eta-failure", fail)
        assert await execution.run_training_job("eta-failure", lambda: 1) == 1

    asyncio.run(scenario())


@pytest.fixture
def eta_routes():
    # Load this route directly: routes/__init__.py also starts unrelated
    # PyTorch/GNN routes, which are outside this regression's dependencies.
    name = "eta_training_test_routes"
    spec = importlib.util.spec_from_file_location(
        name, Path(__file__).parents[1] / "routes" / "eta_routes.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    with patch.object(TrafficPipeline, "__init__", return_value=None):
        spec.loader.exec_module(module)
    module.traffic_pipeline = SimpleNamespace(train_model=MagicMock())
    yield module
    sys.modules.pop(name, None)


def test_eta_train_uses_training_executor(eta_routes, monkeypatch):
    runner = AsyncMock()
    monkeypatch.setattr(eta_routes, "run_training_job", runner)
    monkeypatch.setattr(eta_routes, "run_inference", AsyncMock(side_effect=AssertionError("inference used")))
    assert asyncio.run(eta_routes.train_model(None))["status"] == "success"
    runner.assert_awaited_once_with("eta_lstm", eta_routes.traffic_pipeline.train_model, epochs=50)


@pytest.mark.parametrize("error,status", [(asyncio.TimeoutError(), 504), (HTTPException(503, "busy"), 503), (HTTPException(409, "busy"), 409)])
def test_eta_train_preserves_overload_and_timeout_status(eta_routes, monkeypatch, error, status):
    monkeypatch.setattr(eta_routes, "run_training_job", AsyncMock(side_effect=error))
    with pytest.raises(HTTPException) as result:
        asyncio.run(eta_routes.train_model(None))
    assert result.value.status_code == status
