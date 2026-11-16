"""Native PyG/Adam and mounted observed-horizon training evidence."""

import asyncio
import copy
import math
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from gat.model import GATTrainer, SpatialTemporalGAT
from gat.training_transition import TrainingAdmissionError, TrainingCandidateError
from torch_geometric.data import Data


@pytest.fixture
def trainer():
    torch.manual_seed(71)
    network = SpatialTemporalGAT(
        in_features=5,
        hidden_features=8,
        out_features=4,
        num_heads=2,
        num_layers=1,
        time_steps=1,
        prediction_horizon=2,
    )
    for module in network.modules():
        if isinstance(module, torch.nn.Dropout):
            module.p = 0
    network.lstm.dropout = 0
    network.temporal_attention.dropout = 0
    return GATTrainer(network, device="cpu")


def graph():
    return Data(
        x=torch.arange(10, dtype=torch.float32).reshape(2, 5) / 10,
        edge_index=torch.tensor([[0, 1], [1, 0]]),
    )


def snapshot(trainer):
    return (
        trainer.model,
        trainer.optimizer,
        copy.deepcopy(trainer.model.state_dict()),
        copy.deepcopy(trainer.optimizer.state_dict()),
        [
            None if p.grad is None else p.grad.clone()
            for p in trainer.model.parameters()
        ],
        [m.training for m in trainer.model.modules()],
    )


def equal(actual, expected):
    if isinstance(expected, torch.Tensor):
        torch.testing.assert_close(actual, expected, rtol=0, atol=0)
    elif isinstance(expected, dict):
        assert actual.keys() == expected.keys()
        for key in expected:
            equal(actual[key], expected[key])
    elif isinstance(expected, (tuple, list)):
        assert len(actual) == len(expected)
        for a, b in zip(actual, expected):
            equal(a, b)
    else:
        assert actual == expected


def unchanged(trainer, before):
    model, optimizer, weights, state, gradients, modes = before
    assert trainer.model is model and trainer.optimizer is optimizer
    equal(trainer.model.state_dict(), weights)
    equal(trainer.optimizer.state_dict(), state)
    assert [m.training for m in trainer.model.modules()] == modes
    for p, old in zip(model.parameters(), gradients):
        if old is None:
            assert p.grad is None
        else:
            equal(p.grad, old)


@pytest.mark.parametrize("dtype", [torch.float32, torch.float64])
def test_independent_native_mse_first_adam_and_modes(trainer, dtype):
    if dtype == torch.float64:
        trainer.model.double()
    data = graph()
    data.x = data.x.to(dtype)
    targets = torch.tensor([[0.1, 0.2], [0.3, 0.4]], dtype=dtype)
    reference = copy.deepcopy(trainer.model)
    reference.train()
    prediction = reference(data.x, data.edge_index)
    reference_loss = ((prediction - targets.unsqueeze(0)) ** 2).sum() / 4
    reference_loss.backward()
    norm = math.sqrt(
        sum(
            float((p.grad.double() ** 2).sum())
            for p in reference.parameters()
            if p.grad is not None
        )
    )
    factor = min(1.0, 1.0 / (norm + 1e-6))
    expected = []
    for p in reference.parameters():
        g = None if p.grad is None else p.grad * factor
        expected.append(
            p.detach() if g is None else p.detach() - 0.001 * g / (g.abs() + 1e-8)
        )
    trainer.model.eval()
    trainer.model.spatial_layers[0].train()
    modes = [m.training for m in trainer.model.modules()]
    loss = trainer.train_step(data, targets)
    np.testing.assert_allclose(loss, reference_loss.item(), rtol=1e-6)
    for p, wanted in zip(trainer.model.parameters(), expected):
        torch.testing.assert_close(p, wanted, rtol=2e-6, atol=2e-8)
    assert [m.training for m in trainer.model.modules()] == modes
    assert all(entry["step"].item() == 1 for entry in trainer.optimizer.state.values())


@pytest.mark.parametrize(
    "bad",
    [
        "nan_target",
        "inf_target",
        "wrong_horizon",
        "empty_nodes",
        "bad_feature",
        "fractional_edge",
        "foreign_edge",
        "bad_feature_width",
        "integer_feature",
        "too_many_nodes",
    ],
)
def test_complete_invalid_tuple_preserves_native_state(trainer, bad):
    data, targets = graph(), torch.ones(2, 2)
    if bad == "nan_target":
        targets[-1, -1] = torch.nan
    elif bad == "inf_target":
        targets[-1, -1] = torch.inf
    elif bad == "wrong_horizon":
        targets = torch.ones(2, 3)
    elif bad == "empty_nodes":
        data.x = torch.ones(0, 5)
    elif bad == "bad_feature":
        data.x[-1, -1] = torch.nan
    elif bad == "fractional_edge":
        data.edge_index = torch.tensor([[0.0, 1.1], [1.0, 0.0]])
    elif bad == "foreign_edge":
        data.edge_index[0, 0] = 2
    elif bad == "bad_feature_width":
        data.x = torch.ones(2, 4)
    elif bad == "integer_feature":
        data.x = data.x.long()
    else:
        data.x, targets = torch.ones(4097, 5), torch.ones(4097, 2)
    before = snapshot(trainer)
    with pytest.raises(TrainingAdmissionError):
        trainer.train_step(data, targets)
    unchanged(trainer, before)


@pytest.mark.parametrize("epochs", [0, 17, True, 1.1, "1"])
def test_strict_work_counts(trainer, epochs):
    before = snapshot(trainer)
    with pytest.raises(TrainingAdmissionError):
        trainer.train(graph(), torch.ones(2, 2), epochs)
    unchanged(trainer, before)


@pytest.mark.parametrize("partial", [True, False])
def test_invalid_complete_validation_is_admitted_before_training(trainer, partial):
    before = snapshot(trainer)
    target = torch.ones(2, 2)
    target[-1, -1] = torch.nan
    with pytest.raises(TrainingAdmissionError):
        trainer.train(
            graph(), torch.ones(2, 2), 2, graph(), None if partial else target
        )
    unchanged(trainer, before)


def test_finite_real_adam_overflow_recovers_prior_moments_gradients_modes(trainer):
    trainer.train_step(graph(), torch.ones(2, 2))
    trainer.model.eval()
    trainer.model.spatial_layers[0].train()
    trainer.optimizer.param_groups[0]["weight_decay"] = 1e30
    before = snapshot(trainer)
    with pytest.raises(TrainingCandidateError):
        trainer.train_step(graph(), torch.ones(2, 2))
    unchanged(trainer, before)
    trainer.optimizer.param_groups[0]["weight_decay"] = 0
    assert math.isfinite(trainer.train_step(graph(), torch.zeros(2, 2)))
    assert all(entry["step"].item() == 2 for entry in trainer.optimizer.state.values())


def test_actual_post_adam_failure_retains_earlier_accepted_epoch(trainer, monkeypatch):
    original = trainer.optimizer.step
    accepted = []
    count = 0

    def fail_second(*args, **kwargs):
        nonlocal count
        count += 1
        result = original(*args, **kwargs)
        if count == 1:
            accepted.append(snapshot(trainer))
        else:
            raise RuntimeError("failure after actual second Adam operation")
        return result

    monkeypatch.setattr(trainer.optimizer, "step", fail_second)
    trainer.model.train()
    with pytest.raises(RuntimeError):
        trainer.train(graph(), torch.ones(2, 2), 2)
    unchanged(trainer, accepted[0])
    assert all(entry["step"].item() == 1 for entry in trainer.optimizer.state.values())


def test_nonfinite_native_objective_or_gradient_recovers(trainer):
    before = snapshot(trainer)
    with pytest.raises(TrainingCandidateError):
        trainer.train_step(graph(), torch.full((2, 2), 1e30))
    unchanged(trainer, before)


def test_native_forward_exception_recovers_modes_and_gradients(trainer, monkeypatch):
    trainer.train_step(graph(), torch.ones(2, 2))
    trainer.model.eval()
    before = snapshot(trainer)
    original = trainer.model.forward

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("after actual native graph forward")

    monkeypatch.setattr(trainer.model, "forward", fail)
    with pytest.raises(RuntimeError):
        trainer.train_step(graph(), torch.ones(2, 2))
    unchanged(trainer, before)


def test_training_owns_graph_targets_and_validation_before_native_forward(
    trainer, monkeypatch
):
    data, target, validation, val_target = (
        graph(),
        torch.ones(2, 2),
        graph(),
        torch.zeros(2, 2),
    )
    expected = data.x.clone()
    expected_edges = data.edge_index.clone()
    original = trainer.model.forward
    seen = []

    def mutate_caller(x, edge_index):
        data.x[:] = torch.nan
        data.edge_index[:] = 200
        target[:] = torch.nan
        validation.x[:] = torch.nan
        val_target[:] = torch.nan
        torch.testing.assert_close(x, expected)
        torch.testing.assert_close(edge_index, expected_edges)
        seen.append(True)
        return original(x, edge_index)

    monkeypatch.setattr(trainer.model, "forward", mutate_caller)
    result = trainer.train(data, target, 2, validation, val_target)
    assert (
        len(seen) == 4
        and np.isfinite(result["train_losses"] + result["val_losses"]).all()
    )


def test_native_validation_preserves_mixed_modes_and_gradients(trainer):
    trainer.train_step(graph(), torch.ones(2, 2))
    trainer.model.eval()
    trainer.model.spatial_layers[0].train()
    before = snapshot(trainer)
    assert math.isfinite(trainer.validate(graph(), torch.zeros(2, 2)))
    unchanged(trainer, before)
    with pytest.raises(TrainingCandidateError):
        trainer.validate(graph(), torch.full((2, 2), 1e30))
    unchanged(trainer, before)


def body():
    return {
        "nodes": [
            {"id": 20, "lat": 0.0, "lng": 0.0},
            {"id": 10, "lat": 1.0, "lng": 1.0},
        ],
        "edges": [{"source": 20, "target": 10, "distance": 1.0}],
        "targets": [
            {"node_id": 10, "values": [0.3, 0.4]},
            {"node_id": 20, "values": [0.1, 0.2]},
        ],
        "epochs": 1,
    }


@pytest.fixture
def app(trainer, monkeypatch):
    from routes import gat_routes

    monkeypatch.setattr(gat_routes, "trainer", trainer)
    application = FastAPI()
    application.include_router(gat_routes.router)
    return application


def test_mounted_native_observations_match_node_identity_and_requested_epoch(
    trainer, app, monkeypatch
):
    original = trainer.train
    captured = []

    def record(data, targets, *args, **kwargs):
        captured.append(targets.detach().clone())
        return original(data, targets, *args, **kwargs)

    monkeypatch.setattr(trainer, "train", record)
    response = TestClient(app).post("/gat/train", json=body())
    assert response.status_code == 200, response.text
    observed = response.json()["data"]
    assert observed["target_source"] == "provided_observations" and observed[
        "node_ids"
    ] == [20, 10]
    assert observed["horizon"] == 2 and len(observed["train_losses"]) == 1
    torch.testing.assert_close(captured[0], torch.tensor([[0.1, 0.2], [0.3, 0.4]]))
    assert all(entry["step"].item() == 1 for entry in trainer.optimizer.state.values())


@pytest.mark.parametrize(
    "bad",
    [
        "missing",
        "duplicate",
        "foreign",
        "short",
        "partial",
        "bool_epoch",
        "many_epochs",
        "string_target",
    ],
)
def test_mounted_full_observation_rejection_before_step(trainer, app, bad):
    request = body()
    if bad == "missing":
        del request["targets"]
    elif bad == "duplicate":
        request["targets"][1]["node_id"] = 10
    elif bad == "foreign":
        request["targets"][1]["node_id"] = 999
    elif bad == "short":
        request["targets"][1]["values"] = [1.0]
    elif bad == "partial":
        request["targets"].pop()
    elif bad == "bool_epoch":
        request["epochs"] = True
    elif bad == "many_epochs":
        request["epochs"] = 17
    else:
        request["targets"][1]["values"] = ["1", "2"]
    before = snapshot(trainer)
    assert TestClient(app).post("/gat/train", json=request).status_code == 422
    unchanged(trainer, before)


def test_mounted_native_candidate_failure_is_generic500_with_recovery(trainer, app):
    trainer.optimizer.param_groups[0]["weight_decay"] = 1e30
    before = snapshot(trainer)
    response = TestClient(app).post("/gat/train", json=body())
    assert (
        response.status_code == 500
        and response.json()["detail"] == "Internal server error"
    )
    unchanged(trainer, before)


def test_native_training_runs_in_worker_and_waiting_consumer_keeps_one_generation(
    trainer, app, monkeypatch
):
    entered, release = threading.Event(), threading.Event()
    original = trainer.model.forward
    worker_ids = []

    def blocked(*args, **kwargs):
        worker_ids.append(threading.get_ident())
        entered.set()
        assert release.wait(20)
        return original(*args, **kwargs)

    monkeypatch.setattr(trainer.model, "forward", blocked)

    @app.get("/probe")
    async def probe():
        return {"ok": True}

    async def check():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            fitting = asyncio.create_task(client.post("/gat/train", json=body()))
            assert await asyncio.to_thread(entered.wait, 20)
            try:
                response = await asyncio.wait_for(client.get("/probe"), 2)
                assert (
                    response.status_code == 200
                    and worker_ids[0] != threading.get_ident()
                )
                with ThreadPoolExecutor(1) as pool:
                    waiting = pool.submit(trainer.validate, graph(), torch.zeros(2, 2))
                    assert not waiting.done()
                    release.set()
                    assert math.isfinite(await asyncio.to_thread(waiting.result, 20))
            finally:
                release.set()
            assert (await asyncio.wait_for(fitting, 20)).status_code == 200

    asyncio.run(check())


def test_finite_native_objective_and_gradients_with_overflowing_clip_norm(trainer):
    with torch.no_grad():
        trainer.model.prediction_head[0].weight.zero_()
        trainer.model.prediction_head[0].bias.fill_(1e30)
        trainer.model.prediction_head[-1].weight.zero_()
        trainer.model.prediction_head[-1].bias.fill_(1.0)
    reference = copy.deepcopy(trainer.model)
    native = reference(graph().x, graph().edge_index)
    loss = ((native - torch.zeros_like(native)) ** 2).mean()
    assert loss.item() == 1.0
    loss.backward()
    assert all(
        p.grad is None or torch.isfinite(p.grad).all() for p in reference.parameters()
    )
    assert (
        max(
            float(p.grad.abs().max())
            for p in reference.parameters()
            if p.grad is not None
        )
        >= 1e29
    )
    before = snapshot(trainer)
    with pytest.raises(RuntimeError, match="non-finite"):
        trainer.train_step(graph(), torch.zeros(2, 2))
    unchanged(trainer, before)


def test_genuine_batched_temporal_training_and_validation_tuple(trainer):
    data = graph()
    data.x = data.x[None, :, None, :].repeat(2, 1, 3, 1)
    data.x[1, :, 2, :] += 0.2
    targets = torch.zeros(2, 2, 2)
    result = trainer.train(data, targets, 2, data, targets)
    assert len(result["train_losses"]) == len(result["val_losses"]) == 2
    assert np.isfinite(result["train_losses"] + result["val_losses"]).all()
    assert all(entry["step"].item() == 2 for entry in trainer.optimizer.state.values())
