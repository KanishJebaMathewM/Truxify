"""Actual model/autograd/Adam admission, recovery and accepted continuation."""

import copy
import threading

import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from mtl.model import MTLLoss, MultiTaskModel, MultiTaskTrainer
from mtl.training_transition import TrainingAdmissionError, TrainingCandidateError
from torch import nn


def native():
    torch.manual_seed(17794)
    model = MultiTaskModel(2, {"eta": {"output_dim": 1},
                              "risk": {"output_dim": 2, "type": "classification"}}, 4)
    for layer in model.modules():
        if isinstance(layer, nn.Dropout):
            layer.p = 0
    item = MultiTaskTrainer(model, MTLLoss({"eta": nn.MSELoss(), "risk": nn.CrossEntropyLoss()}),
                            device="cpu", task_weights={"eta": .2, "risk": 2.})
    item.gradient_method = "standard"
    return item


def batch():
    return torch.tensor([[1., 2.], [2., 3.]]), {"eta": torch.tensor([[1.], [2.]]),
                                             "risk": torch.tensor([0, 1])}


def snapshot(item):
    return copy.deepcopy((item.model.state_dict(), item.optimizer.state_dict(), item.scheduler.state_dict(),
                          [p.grad for p in item.model.parameters()],
                          [m.training for m in item.model.modules()]))


def equal(left, right):
    if isinstance(left, torch.Tensor):
        assert torch.equal(left, right)
    elif isinstance(left, dict):
        assert left.keys() == right.keys()
        for key in left:
            equal(left[key], right[key])
    elif isinstance(left, (list, tuple)):
        assert len(left) == len(right)
        for a, b in zip(left, right):
            equal(a, b)
    else:
        assert left == right


def warmed():
    item = native()
    item.train_step(*batch())
    item.model.eval()
    item.model.task_heads["eta"].train()
    return item


@pytest.mark.parametrize("fault", ["input_nan", "target_inf", "shape", "dtype", "missing", "extra",
                                   "class_range", "class_dtype", "class_shape", "empty", "weight_nan",
                                   "weight_bool", "negative_weight", "unknown_weight", "unknown_method",
                                   "missing_loss", "noncallable_loss", "batch_work"])
def test_complete_direct_admission_preserves_warmed_state_and_prior_gradients(fault):
    item = warmed()
    x, targets = batch()
    if fault == "input_nan": x[0, 0] = float("nan")
    elif fault == "target_inf": targets["eta"][0] = float("inf")
    elif fault == "shape": x = x[:, :1]
    elif fault == "dtype": targets["eta"] = targets["eta"].double()
    elif fault == "missing": del targets["risk"]
    elif fault == "extra": targets["other"] = targets["eta"]
    elif fault == "class_range": targets["risk"][0] = 2
    elif fault == "class_dtype": targets["risk"] = targets["risk"].float()
    elif fault == "class_shape": targets["risk"] = targets["risk"][:, None]
    elif fault == "empty": x = x[:0]
    elif fault == "weight_nan": item.task_weights["eta"] = float("nan")
    elif fault == "weight_bool": item.task_weights["eta"] = True
    elif fault == "negative_weight": item.task_weights["eta"] = -1.
    elif fault == "unknown_weight": item.task_weights["other"] = 1.
    elif fault == "unknown_method": item.gradient_method = "typo"
    elif fault == "missing_loss": del item.loss.task_losses["risk"]
    elif fault == "noncallable_loss": item.loss.task_losses["risk"] = 1
    elif fault == "batch_work": x = torch.zeros(1_000_001, 2)
    before = snapshot(item)
    identities = (item.model, item.optimizer, item.scheduler)
    with pytest.raises(TrainingAdmissionError):
        item.train_step(x, targets)
    equal(snapshot(item), before)
    assert identities == (item.model, item.optimizer, item.scheduler)


class RootLoss(nn.Module):
    def forward(self, prediction, target):
        # Native sqrt at zero has an infinite local derivative. No substituted
        # autograd or optimizer operations are needed to reproduce failure.
        return torch.sqrt(torch.abs(prediction - target).mean())


@pytest.mark.parametrize("fault", ["loss_overflow", "weighted_overflow", "gradient_nonfinite",
                                   "nonscalar_loss", "forward_failure", "native_adam_post_failure"])
def test_failed_native_transition_recovers_previous_model_adam_gradients_and_modes(fault):
    item = warmed()
    x, targets = batch()
    hook = None
    if fault == "loss_overflow": targets["eta"].fill_(1e30)
    elif fault == "weighted_overflow": item.task_weights["risk"] = 1e308
    elif fault == "gradient_nonfinite":
        item.loss.task_losses["eta"] = RootLoss()
        item.model.eval()
        targets["eta"] = item.model.forward_for_loss(x)["eta"].detach()
    elif fault == "nonscalar_loss": item.loss.task_losses["eta"] = nn.MSELoss(reduction="none")
    elif fault == "forward_failure":
        item.model.register_buffer("native_receipt", torch.tensor(0.))
        def fail_forward(*_):
            item.model.native_receipt.add_(1.)
            raise RuntimeError("native forward callback failed")
        hook = item.model.shared_encoder.register_forward_hook(fail_forward)
    elif fault == "native_adam_post_failure":
        def fail_after_native_adam(*_):
            raise RuntimeError("native Adam post-step callback failed")
        hook = item.optimizer.register_step_post_hook(fail_after_native_adam)
    before = snapshot(item)
    identities = (item.model, item.optimizer, item.scheduler)
    try:
        with pytest.raises((TrainingCandidateError, RuntimeError)):
            item.train_step(x, targets)
    finally:
        if hook is not None: hook.remove()
    equal(snapshot(item), before)
    assert identities == (item.model, item.optimizer, item.scheduler)


@pytest.mark.parametrize("method", ["standard", "pcgrad"])
def test_finite_loss_gradients_but_infinite_actual_adam_moments_reject_and_recover(method):
    item = warmed()
    item.gradient_method = method
    with torch.no_grad():
        for value in item.model.parameters(): value.zero_()
        item.model.task_heads["eta"].head[3].bias.fill_(1e24)
    before = snapshot(item)
    with pytest.raises(TrainingCandidateError, match="Adam candidate"):
        item.train_step(torch.zeros(2, 2), {"eta": torch.ones(2, 1), "risk": torch.zeros(2, dtype=torch.long)})
    equal(snapshot(item), before)
    # Reset the deliberately overflowing latent activation, then compare actual
    # accepted continuation with an independent native autograd/Adam reference.
    with torch.no_grad(): item.model.task_heads["eta"].head[3].bias.zero_()
    item.gradient_method = "standard"
    reference_model = copy.deepcopy(item.model)
    reference_optimizer = torch.optim.Adam(reference_model.parameters(), lr=1e-3)
    reference_optimizer.load_state_dict(copy.deepcopy(item.optimizer.state_dict()))
    x, targets = batch()
    expected = reference_model.forward_for_loss(x)
    loss = .2 * nn.MSELoss()(expected["eta"], targets["eta"]) + 2 * nn.CrossEntropyLoss()(expected["risk"], targets["risk"])
    reference_optimizer.zero_grad(); loss.backward(); reference_optimizer.step()
    actual = item.train_step(x, targets)
    assert actual["total_loss"] == loss.item()
    equal(item.model.state_dict(), reference_model.state_dict())
    equal(item.optimizer.state_dict(), reference_optimizer.state_dict())


def test_owned_batch_and_weight_policy_survive_caller_mutation_during_forward():
    left, right = native(), native()
    x, targets = batch()
    expected = right.train_step(x.clone(), {k: v.clone() for k, v in targets.items()})
    def mutate_source(*_):
        x.fill_(999.); targets["eta"].fill_(999.); left.task_weights["eta"] = 999.
        left.gradient_method = "pcgrad"
    hook = left.model.shared_encoder.register_forward_pre_hook(mutate_source)
    try: actual = left.train_step(x, targets)
    finally: hook.remove()
    assert actual == expected
    equal(left.model.state_dict(), right.model.state_dict())
    equal(left.optimizer.state_dict(), right.optimizer.state_dict())


def mounted():
    from routes import mtl_routes
    app = FastAPI(); app.include_router(mtl_routes.router)
    return TestClient(app), mtl_routes


@pytest.mark.parametrize("body", [{"epochs": 0}, {"epochs": True}, {"epochs": "1"}, {"epochs": 1.0},
                                  {"epochs": 101}, {"batch_size": -1}, {"batch_size": 8193},
                                  {"data_size": 0}, {"data_size": 50001}, {"data_size": True},
                                  {"epochs": 100, "data_size": 10001}])
def test_actual_mounted_training_counts_reject_before_allocating_or_mutating(body):
    client, route = mounted()
    before = snapshot(route.trainer)
    assert client.post("/mtl/train", json=body).status_code == 422
    equal(snapshot(route.trainer), before)


def test_actual_mounted_valid_small_training_still_uses_native_model_and_adam():
    client, route = mounted()
    response = client.post("/mtl/train", json={"epochs": 1, "batch_size": 2, "data_size": 4})
    assert response.status_code == 200, response.text
    assert route.trainer.optimizer.state
    assert response.json()["data"]["final_loss"] >= 0


def test_actual_mounted_internal_adam_candidate_failure_is500_and_recovers(monkeypatch):
    client, route = mounted()
    model = MultiTaskModel(route.input_dim, route.tasks, 4)
    with torch.no_grad():
        for parameter in model.parameters(): parameter.zero_()
        model.task_heads["eta"].head[3].bias.fill_(1e24)
    item = MultiTaskTrainer(model, MTLLoss(route.task_losses), device="cpu")
    item.gradient_method = "standard"
    monkeypatch.setattr(route, "trainer", item)
    before = snapshot(item)
    torch.manual_seed(17794)
    response = client.post("/mtl/train", json={"epochs": 1, "batch_size": 4, "data_size": 4})
    assert response.status_code == 500, response.text
    assert response.json()["detail"] == "Internal server error"
    equal(snapshot(item), before)


def test_native_prediction_waits_until_failed_adam_candidate_has_recovered():
    item = warmed()
    with torch.no_grad():
        for parameter in item.model.parameters(): parameter.zero_()
        item.model.task_heads["eta"].head[3].bias.fill_(1e24)
    x = torch.zeros(2, 2)
    targets = {"eta": torch.ones(2, 1), "risk": torch.zeros(2, dtype=torch.long)}
    before = item.predict(x)
    admitted, release, reader_entered, reader_finished = [threading.Event() for _ in range(4)]
    failures, predictions = [], []
    def hold_native_candidate(*_):
        admitted.set()
        assert release.wait(5)
    hook = item.optimizer.register_step_post_hook(hold_native_candidate)
    def write():
        try: item.train_step(x, targets)
        except TrainingCandidateError as error: failures.append(error)
    def read():
        reader_entered.set()
        predictions.append(item.predict(x))
        reader_finished.set()
    writer, reader = threading.Thread(target=write), threading.Thread(target=read)
    try:
        writer.start(); assert admitted.wait(5)
        reader.start(); assert reader_entered.wait(5)
        assert not reader_finished.wait(.05)
    finally:
        release.set(); writer.join(5)
        if reader.ident is not None: reader.join(5)
        hook.remove()
    assert not writer.is_alive() and not reader.is_alive()
    assert len(failures) == 1 and len(predictions) == 1
    equal(predictions[0], before)
