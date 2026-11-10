"""Native model/Adam continuation and controlled generation lifetime tests."""

import copy
import threading
from concurrent.futures import ThreadPoolExecutor

import httpx
import pytest
import torch
from fastapi import FastAPI
from meta.model import MAML, MAMLModel


def learner():
    torch.manual_seed(17)
    result = MAML(MAMLModel(2, 4, 1, 1), device="cpu", inner_lr=0.03, outer_lr=0.02)
    result.model.eval()  # deterministic independent Adam/second-order comparison
    return result


def task():
    sx = torch.tensor([[1.0, 2.0], [-2.0, 1.0]])
    sy = torch.tensor([[2.0], [-1.0]])
    qx = torch.tensor([[1.0, -1.0], [2.0, 2.0]])
    qy = torch.tensor([[3.0], [1.0]])
    return sx, sy, qx, qy


def pair(maml):
    return copy.deepcopy(
        {
            "model_state_dict": maml.model.state_dict(),
            "optimizer_state_dict": maml.outer_optimizer.state_dict(),
        }
    )


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for key in a:
            equal(a[key], b[key])
    elif isinstance(a, (list, tuple)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def initialized():
    maml = learner()
    maml.meta_train_step([task()])
    return maml


@pytest.mark.parametrize(
    "corruption",
    [
        "missing_pair",
        "bad_model_shape",
        "nan_model",
        "bad_groups",
        "duplicate_ids",
        "unknown_state",
        "bad_moment_shape",
        "nan_moment",
        "negative_second_moment",
        "fractional_step",
        "infinite_step",
        "missing_moment",
        "bad_lr",
        "bad_betas",
        "bad_flag",
        "conflicting_execution",
    ],
)
def test_rejected_checkpoint_preserves_entire_active_pair(tmp_path, corruption):
    maml = initialized()
    before = pair(maml)
    old_model = maml.model
    old_optimizer = maml.outer_optimizer
    query = task()[2]
    prediction = maml.model(query).detach().clone()
    checkpoint = pair(maml)
    for tensor in checkpoint["model_state_dict"].values():
        tensor.add_(7)
    adam = checkpoint["optimizer_state_dict"]
    entry = next(iter(adam["state"].values()))
    group = adam["param_groups"][0]
    if corruption == "missing_pair":
        checkpoint["optimizer_state_dict"] = {"invalid": True}
    elif corruption == "bad_model_shape":
        checkpoint["model_state_dict"][next(iter(checkpoint["model_state_dict"]))] = (
            torch.ones(99)
        )
    elif corruption == "nan_model":
        next(iter(checkpoint["model_state_dict"].values())).fill_(float("nan"))
    elif corruption == "bad_groups":
        adam["param_groups"] = []
    elif corruption == "duplicate_ids":
        group["params"][1] = group["params"][0]
    elif corruption == "unknown_state":
        adam["state"][999] = copy.deepcopy(entry)
    elif corruption == "bad_moment_shape":
        entry["exp_avg"] = torch.ones(99)
    elif corruption == "nan_moment":
        entry["exp_avg"].fill_(float("nan"))
    elif corruption == "negative_second_moment":
        entry["exp_avg_sq"].fill_(-1)
    elif corruption == "fractional_step":
        entry["step"] = torch.tensor(0.5)
    elif corruption == "infinite_step":
        entry["step"] = torch.tensor(float("inf"))
    elif corruption == "missing_moment":
        del entry["exp_avg"]
    elif corruption == "bad_lr":
        group["lr"] = float("nan")
    elif corruption == "bad_betas":
        group["betas"] = (1.0, 0.99)
    elif corruption == "bad_flag":
        group["capturable"] = True
    elif corruption == "conflicting_execution":
        group["foreach"] = group["fused"] = True
    path = tmp_path / "bad.pth"
    torch.save(checkpoint, path)
    with pytest.raises((ValueError, RuntimeError, KeyError)):
        maml.load(path)
    assert maml.model is old_model and maml.outer_optimizer is old_optimizer
    equal(before, pair(maml))
    torch.testing.assert_close(maml.model(query), prediction, rtol=0, atol=0)


def independent_meta_step(model, optimizer, inputs, inner_lr):
    sx, sy, qx, qy = inputs
    parameters = dict(model.named_parameters())
    prediction = torch.func.functional_call(model, parameters, (sx,))
    support = (prediction - sy).square().mean()
    gradients = torch.autograd.grad(
        support, tuple(parameters.values()), create_graph=True
    )
    adapted = {
        name: parameter - inner_lr * gradient
        for (name, parameter), gradient in zip(parameters.items(), gradients)
    }
    query = torch.func.functional_call(model, adapted, (qx,))
    loss = (query - qy).square().mean()
    optimizer.zero_grad()
    loss.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    return loss.item()


def test_valid_restore_continues_exact_native_adam_and_meta_gradients(tmp_path):
    source = initialized()
    path = tmp_path / "pair.pth"
    source.save(path)
    restored = learner()
    old = restored.model
    restored.load(path)
    assert restored.model is not old
    reference = copy.deepcopy(source.model)
    optimizer = torch.optim.Adam(reference.parameters(), lr=0.02)
    optimizer.load_state_dict(copy.deepcopy(source.outer_optimizer.state_dict()))
    for _ in range(3):
        expected = independent_meta_step(reference, optimizer, task(), source.inner_lr)
        assert restored.meta_train_step([task()]) == pytest.approx(expected)
        equal(reference.state_dict(), restored.model.state_dict())
        equal(optimizer.state_dict(), restored.outer_optimizer.state_dict())
    assert {
        id(p)
        for group in restored.outer_optimizer.param_groups
        for p in group["params"]
    } == {id(p) for p in restored.model.parameters()}


def test_legacy_adam_optional_flags_are_accepted(tmp_path):
    source = initialized()
    checkpoint = pair(source)
    group = checkpoint["optimizer_state_dict"]["param_groups"][0]
    for key in list(group):
        if key not in {"params", "lr", "betas", "eps", "weight_decay", "amsgrad"}:
            del group[key]
    path = tmp_path / "legacy.pth"
    torch.save(checkpoint, path)
    target = learner()
    target.load(path)
    assert torch.isfinite(torch.tensor(target.meta_train_step([task()])))


def test_failed_save_preserves_previous_file_and_only_cleans_own_temp(
    tmp_path, monkeypatch
):
    maml = initialized()
    path = tmp_path / "valid.pth"
    maml.save(path)
    before = path.read_bytes()
    unrelated = tmp_path / ".maml-unrelated.tmp"
    unrelated.write_bytes(b"keep")

    def fail(snapshot, output):
        if hasattr(output, "write"):
            output.write(b"partial")
        else:
            with open(output, "wb") as destination:
                destination.write(b"partial")
        raise OSError("controlled serialization failure")

    monkeypatch.setattr(torch, "save", fail)
    with pytest.raises(OSError):
        maml.save(path)
    assert path.read_bytes() == before and unrelated.read_bytes() == b"keep"
    assert set(tmp_path.iterdir()) == {path, unrelated}


def test_save_snapshot_is_owned_while_native_training_continues(tmp_path, monkeypatch):
    maml = initialized()
    before = pair(maml)
    path = tmp_path / "owned.pth"
    captured = threading.Event()
    release = threading.Event()
    save = torch.save

    def hold(snapshot, output):
        captured.set()
        assert release.wait(5)
        save(snapshot, output)

    monkeypatch.setattr(torch, "save", hold)
    with ThreadPoolExecutor(2) as pool:
        future = pool.submit(maml.save, path)
        try:
            assert captured.wait(5)
            maml.meta_train_step([task()])
        finally:
            release.set()
        future.result(5)
    equal(before, torch.load(path, weights_only=True))
    assert any(
        not torch.equal(v, before["model_state_dict"][k])
        for k, v in maml.model.state_dict().items()
    )


@pytest.mark.parametrize("operation", ["train", "adapt"])
def test_restore_waits_for_admitted_native_generation(tmp_path, monkeypatch, operation):
    maml = initialized()
    old_model = maml.model
    replacement = learner()
    for parameter in replacement.model.parameters():
        parameter.data.add_(1)
    path = tmp_path / "new.pth"
    replacement.save(path)
    entered = threading.Event()
    release = threading.Event()
    loaded = threading.Event()
    attempted = threading.Event()
    if operation == "train":
        original = maml.inner_update

        def hold(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(maml, "inner_update", hold)
        run = lambda: maml.meta_train_step([task()])
    else:
        original = maml.criterion.forward

        def hold(*args, **kwargs):
            entered.set()
            assert release.wait(5)
            return original(*args, **kwargs)

        monkeypatch.setattr(maml.criterion, "forward", hold)
        run = lambda: maml.adapt(task()[0], task()[1], 1, training=False)

    def load():
        attempted.set()
        maml.load(path)
        loaded.set()

    with ThreadPoolExecutor(2) as pool:
        current = pool.submit(run)
        try:
            assert entered.wait(5)
            restore = pool.submit(load)
            assert attempted.wait(5)
            assert not loaded.wait(0.1)
            assert maml.model is old_model
        finally:
            release.set()
        admitted = current.result(5)
        restore.result(5)
    assert maml.model is not old_model
    if operation == "adapt":
        assert all(torch.isfinite(tensor).all() for tensor in admitted.params.values())
        grads = torch.autograd.grad(
            admitted(task()[2]).square().mean(),
            tuple(old_model.parameters()),
            create_graph=True,
        )
        assert any(g.abs().sum() > 0 for g in grads)


def test_retired_adapted_loss_cannot_step_replacement_optimizer(tmp_path):
    maml = initialized()
    adapted = maml.adapt(task()[0], task()[1], 1, training=False)
    loss = adapted(task()[2]).square().mean()
    path = tmp_path / "new.pth"
    learner().save(path)
    maml.load(path)
    before = pair(maml)
    with pytest.raises(RuntimeError):
        maml.outer_update(loss)
    equal(before, pair(maml))


@pytest.mark.asyncio
async def test_actual_meta_load_route_rejects_without_predictor_mutation(
    tmp_path, monkeypatch
):
    from routes import meta_routes as routes

    maml = initialized()
    before = pair(maml)
    checkpoint = pair(maml)
    for value in checkpoint["model_state_dict"].values():
        value.add_(9)
    checkpoint["optimizer_state_dict"] = {"invalid": True}
    (tmp_path / "models").mkdir()
    torch.save(checkpoint, tmp_path / "models/bad.pth")
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr(routes, "maml", maml)
    app = FastAPI()
    app.include_router(routes.router)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await client.post("/meta/load", params={"path": "bad.pth"})
        assert response.status_code == 500 and response.json() == {
            "detail": "Internal server error"
        }
        info = await client.get("/meta/model-info")
        assert info.status_code == 200
        assert info.json()["data"]["parameters"] == sum(
            p.numel() for p in maml.model.parameters()
        )
    equal(before, pair(maml))
    old_model = maml.model
    torch.save(before, tmp_path / "models/valid.pth")
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        restored = await client.post("/meta/load", params={"path": "valid.pth"})
        assert restored.status_code == 200
    assert maml.model is not old_model
    equal(before, pair(maml))
