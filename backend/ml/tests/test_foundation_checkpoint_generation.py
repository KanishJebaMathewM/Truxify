"""Actual trained Transformer/tokenizer/file and worker generation controls."""

import asyncio
import copy
import importlib
import json
import math
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from foundation import checkpoint_generation as generation
from foundation.data import LogisticsDataProcessor
from foundation.model import (
    FoundationModelConfig,
    FoundationModelTrainer,
    LogisticsFoundationModel,
)


def native():
    torch.manual_seed(23)
    config = FoundationModelConfig(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=1,
        d_ff=16,
        max_len=8,
        dropout=0,
        epochs=1,
        batch_size=2,
    )
    model = LogisticsFoundationModel(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=1,
        d_ff=16,
        max_len=8,
        dropout=0,
    )
    trainer = FoundationModelTrainer(model, config)
    trainer.train_step(
        {"input_ids": torch.tensor([[0, 1]]), "labels": torch.tensor([1])}
    )
    processor = LogisticsDataProcessor()
    processor.vocab = {"old": 0, "word": 1}
    return trainer, processor


def state(trainer, processor):
    return (
        copy.deepcopy(trainer.model.state_dict()),
        copy.deepcopy(trainer.optimizer.state_dict()),
        copy.deepcopy(trainer.scheduler.state_dict()),
        copy.deepcopy(vars(trainer.config)),
        processor.vocab.copy(),
    )


def same(actual, expected):
    if isinstance(expected, torch.Tensor):
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    elif isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            same(actual[key], expected[key])
    elif isinstance(expected, (tuple, list)):
        assert len(actual) == len(expected)
        for a, b in zip(actual, expected):
            same(a, b)
    else:
        assert actual == expected


def test_native_trained_bundle_roundtrip_tokenizer_predictions_and_fresh_adam(tmp_path):
    trainer, processor = native()
    path = tmp_path / "paired.pth"
    before = state(trainer, processor)
    generation.save_bundle(trainer, processor, path)
    candidate, tokenizer, metadata = generation.load_bundle(trainer, processor, path)
    assert candidate is not trainer and tokenizer is not processor
    assert metadata == {
        "vocabulary_source": "bundled",
        "training_state": "fresh_adamw_scheduler",
    }
    same(candidate.model.state_dict(), trainer.model.state_dict())
    assert tokenizer.prepare_sequence("old word") == [0, 1]
    trainer.model.eval()
    candidate.model.eval()
    torch.testing.assert_close(
        candidate.model(torch.tensor([[0, 1]]))["output"],
        trainer.model(torch.tensor([[0, 1]]))["output"],
        rtol=0,
        atol=0,
    )
    assert not candidate.optimizer.state
    assert candidate.scheduler.optimizer is candidate.optimizer
    assert {id(p) for g in candidate.optimizer.param_groups for p in g["params"]} == {
        id(p) for p in candidate.model.parameters()
    }
    loss = candidate.train_step(
        {"input_ids": torch.tensor([[0, 1]]), "labels": torch.tensor([0])}
    )
    assert all(math.isfinite(v) for v in loss.values())
    assert all(v["step"].item() == 1 for v in candidate.optimizer.state.values())
    same(state(trainer, processor), before)


@pytest.mark.parametrize(
    "kind",
    [
        "partial",
        "nonfinite",
        "dtype",
        "missing",
        "negative_id",
        "bool_id",
        "duplicate_id",
        "sparse_id",
        "capacity",
        "empty_word",
        "unknown_format",
        "missing_vocab",
        "geometry",
        "policy",
    ],
)
def test_complete_bad_bundle_preserves_original_native_generation(tmp_path, kind):
    trainer, processor = native()
    path = tmp_path / "bad.pth"
    generation.save_bundle(trainer, processor, path)
    payload = torch.load(path, weights_only=True)
    payload["model_state_dict"]["token_embedding.weight"].fill_(9.0)
    if kind == "partial":
        payload["model_state_dict"]["classification_head.bias"] = torch.ones(3)
    elif kind == "nonfinite":
        payload["model_state_dict"]["classification_head.bias"].fill_(torch.nan)
    elif kind == "dtype":
        payload["model_state_dict"]["classification_head.bias"] = payload[
            "model_state_dict"
        ]["classification_head.bias"].double()
    elif kind == "missing":
        payload["model_state_dict"].pop("classification_head.bias")
    elif kind == "negative_id":
        payload["vocab"] = {"old": -1}
    elif kind == "bool_id":
        payload["vocab"] = {"old": False}
    elif kind == "duplicate_id":
        payload["vocab"] = {"a": 0, "b": 0}
    elif kind == "sparse_id":
        payload["vocab"] = {"old": 8}
    elif kind == "capacity":
        payload["vocab"] = {str(i): i for i in range(17)}
    elif kind == "empty_word":
        payload["vocab"] = {"": 0}
    elif kind == "unknown_format":
        payload["format"] = "unknown"
    elif kind == "missing_vocab":
        del payload["vocab"]
    elif kind == "geometry":
        payload["config"]["num_heads"] = 4
    else:
        payload["config"]["learning_rate"] = float("nan")
    torch.save(payload, path)
    before = state(trainer, processor)
    with pytest.raises((ValueError, TypeError)):
        generation.load_bundle(trainer, processor, path)
    same(state(trainer, processor), before)


@pytest.mark.parametrize("bad", [True, False])
def test_legacy_pair_is_staged_before_publication_and_marked(tmp_path, bad):
    trainer, processor = native()
    path = tmp_path / "legacy.pth"
    trainer.save(path)
    vocab = tmp_path / "vocab.json"
    vocab.write_text("{ malformed" if bad else json.dumps({"new": 0, "word": 1}))
    before = state(trainer, processor)
    if bad:
        with pytest.raises(json.JSONDecodeError):
            generation.load_bundle(trainer, processor, path, vocab)
    else:
        candidate, tokenizer, metadata = generation.load_bundle(
            trainer, processor, path, vocab
        )
        assert tokenizer.vocab == {"new": 0, "word": 1}
        assert metadata["vocabulary_source"] == "legacy_selected_file"
        assert not candidate.optimizer.state
    same(state(trainer, processor), before)


def test_versioned_files_each_retain_their_own_vocabulary(tmp_path):
    trainer, processor = native()
    first, second = tmp_path / "v1.pth", tmp_path / "v2.pth"
    generation.save_bundle(trainer, processor, first)
    processor.vocab = {"new": 0, "token": 1}
    generation.save_bundle(trainer, processor, second)
    assert generation.load_bundle(trainer, processor, first)[1].vocab == {
        "old": 0,
        "word": 1,
    }
    assert generation.load_bundle(trainer, processor, second)[1].vocab == {
        "new": 0,
        "token": 1,
    }


def test_native_serialization_failure_preserves_old_destination(tmp_path, monkeypatch):
    trainer, processor = native()
    path = tmp_path / "saved.pth"
    generation.save_bundle(trainer, processor, path)
    old_bytes = path.read_bytes()
    original = torch.save

    def fail_after_native_save(payload, stream):
        original(payload, stream)
        raise OSError("after actual native serialization")

    monkeypatch.setattr(torch, "save", fail_after_native_save)
    with pytest.raises(OSError):
        generation.save_bundle(trainer, processor, path)
    assert path.read_bytes() == old_bytes
    assert not list(tmp_path.glob("*.tmp"))


@pytest.mark.parametrize("budget", ["MAX_BYTES", "MAX_VALUES", "MAX_VOCAB_BYTES"])
def test_complete_snapshot_budget_preserves_destination(tmp_path, monkeypatch, budget):
    trainer, processor = native()
    path = tmp_path / "old.pth"
    path.write_bytes(b"previous artifact")
    monkeypatch.setattr(generation, budget, 1)
    with pytest.raises(ValueError):
        generation.save_bundle(trainer, processor, path)
    assert path.read_bytes() == b"previous artifact"


def test_actual_snapshot_is_owned_before_native_serialization(tmp_path, monkeypatch):
    trainer, processor = native()
    expected_weights, expected_vocab = (
        copy.deepcopy(trainer.model.state_dict()),
        processor.vocab.copy(),
    )
    original = torch.save

    def mutate_original(payload, stream):
        with torch.no_grad():
            trainer.model.token_embedding.weight.fill_(99.0)
        processor.vocab = {"changed": 0}
        trainer.config.epochs = 2
        return original(payload, stream)

    monkeypatch.setattr(torch, "save", mutate_original)
    path = tmp_path / "snapshot.pth"
    generation.save_bundle(trainer, processor, path)
    payload = torch.load(path, weights_only=True)
    same(payload["model_state_dict"], expected_weights)
    assert payload["vocab"] == expected_vocab and payload["config"]["epochs"] == 1


@pytest.fixture
def mounted(tmp_path, monkeypatch):
    from foundation import model as source

    class TinyConfig(FoundationModelConfig):
        def __init__(self):
            super().__init__(
                vocab_size=16,
                d_model=8,
                num_heads=2,
                num_layers=1,
                d_ff=16,
                max_len=8,
                dropout=0,
                batch_size=2,
                epochs=1,
            )

    monkeypatch.setattr(source, "FoundationModelConfig", TinyConfig)
    name = "routes.foundation_routes"
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    monkeypatch.chdir(tmp_path)
    route.processor.vocab = {"old": 0, "word": 1}
    route.trainer.train_step(
        {"input_ids": torch.tensor([[0, 1]]), "labels": torch.tensor([1])}
    )
    app = FastAPI()
    app.include_router(route.router)
    yield app, route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def test_actual_mounted_bundle_save_restore_refreshes_all_aliases(mounted):
    app, route = mounted
    client = TestClient(app)
    expected = client.post("/foundation/predict?text=old%20word").json()["data"]
    assert (
        client.post("/foundation/save?path=foundation_model_v2.pth").status_code == 200
    )
    old_trainer, old_processor = route.trainer, route.processor
    with torch.no_grad():
        route.trainer.model.classification_head.bias.fill_(99.0)
    route.processor.vocab = {"different": 0}
    response = client.post("/foundation/load?path=foundation_model_v2.pth")
    assert response.status_code == 200, response.text
    assert response.json()["artifact"]["vocabulary_source"] == "bundled"
    assert route.trainer is not old_trainer and route.processor is not old_processor
    assert route.model is route.trainer.model and route.config is route.trainer.config
    assert route.processor.vocab == {"old": 0, "word": 1}
    assert client.post("/foundation/predict?text=old%20word").json()["data"] == expected
    assert not route.trainer.optimizer.state
    assert (
        client.post("/foundation/load?path=../foundation_model.pth").status_code == 400
    )


def test_actual_mounted_failed_legacy_vocab_preserves_runtime_aliases(mounted):
    app, route = mounted
    from pathlib import Path

    Path("models").mkdir()
    route.trainer.save("models/foundation_model.pth")
    Path("models/vocab.json").write_text("{ malformed")
    before = state(route.trainer, route.processor)
    aliases = (route.model, route.trainer, route.processor, route.config)
    response = TestClient(app).post("/foundation/load")
    assert (
        response.status_code == 500
        and response.json()["detail"] == "Internal server error"
    )
    assert (route.model, route.trainer, route.processor, route.config) == aliases
    same(state(route.trainer, route.processor), before)


def test_actual_load_waits_for_old_native_prediction_and_event_loop_remains_free(
    mounted, monkeypatch
):
    app, route = mounted
    generation.save_bundle(
        route.trainer, route.processor, "models/foundation_model_v2.pth"
    )
    entered, release = threading.Event(), threading.Event()
    old_model, old_trainer = route.model, route.trainer
    original = old_model.forward
    worker_ids = []

    def blocked(*args, **kwargs):
        worker_ids.append(threading.get_ident())
        entered.set()
        assert release.wait(20)
        return original(*args, **kwargs)

    monkeypatch.setattr(old_model, "forward", blocked)

    # Candidate should not copy this test hook into future generations.
    @app.get("/probe")
    async def probe():
        return {"ok": True}

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            predicting = asyncio.create_task(
                client.post("/foundation/predict?text=old%20word")
            )
            assert await asyncio.to_thread(entered.wait, 20)
            loading = asyncio.create_task(
                client.post("/foundation/load?path=foundation_model_v2.pth")
            )
            try:
                assert (
                    await asyncio.wait_for(client.get("/probe"), 2)
                ).status_code == 200
                assert (
                    worker_ids[0] != threading.get_ident()
                    and route.trainer is old_trainer
                )
            finally:
                release.set()
            assert (await asyncio.wait_for(predicting, 20)).status_code == 200
            assert (await asyncio.wait_for(loading, 20)).status_code == 200
            assert (
                route.trainer is not old_trainer and route.model is route.trainer.model
            )

    asyncio.run(check())


def test_native_mutating_workers_wait_while_persistence_owns_generation(
    mounted, monkeypatch
):
    _, route = mounted
    entered, release = threading.Event(), threading.Event()
    original = generation.save_bundle

    def blocked(*args, **kwargs):
        entered.set()
        assert release.wait(20)
        return original(*args, **kwargs)

    monkeypatch.setattr(route, "save_bundle", blocked)
    payload = [
        {
            "origin": "old",
            "destination": "word",
            "cargo_type": "bulk",
            "is_urgent": True,
        }
    ]
    with ThreadPoolExecutor(3) as pool:
        saving = pool.submit(route.save_model, "models/foundation_model.pth")
        assert entered.wait(20)
        preparing = pool.submit(route._native_prepare_data, payload)
        info = pool.submit(route.get_model_info)
        try:
            assert not preparing.done() and not info.done()
        finally:
            release.set()
        assert saving.result(timeout=20)["success"]
        assert (
            preparing.result(timeout=20)["success"]
            and info.result(timeout=20)["success"]
        )
