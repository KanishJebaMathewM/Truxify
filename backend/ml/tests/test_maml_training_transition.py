"""Actual native higher-order training, Adam restoration and mounted route contracts."""
import copy
import importlib.util
import sys
from pathlib import Path

import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from meta.model import MAML, MAMLModel
from meta.training_admission import (
    MetaTrainingInputError,
    MetaTrainingTransitionError,
)


def learner():
    torch.manual_seed(17779)
    item = MAML(MAMLModel(2, 4, 1, 1), device="cpu")
    item.model.eval()
    return item


def task():
    x = torch.tensor([[1., 2.], [2., 3.]])
    y = torch.tensor([[1.], [2.]])
    return x, y, x + 0.5, y + 0.2


def snapshot(item):
    return copy.deepcopy(item.model.state_dict()), copy.deepcopy(item.outer_optimizer.state_dict()), [
        None if p.grad is None else p.grad.clone() for p in item.model.parameters()]


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


def unchanged(item, before):
    equal(snapshot(item), before)


@pytest.mark.parametrize("index", range(4))
@pytest.mark.parametrize("value", [float("nan"), float("inf"), -float("inf")])
def test_every_nonfinite_task_component_preserves_native_model_adam_and_existing_gradients(index, value):
    item = learner()
    item.meta_train_step([task()])
    before = snapshot(item)
    values = list(task())
    values[index][0, 0] = value
    with pytest.raises(MetaTrainingInputError):
        item.meta_train_step([tuple(values)])
    unchanged(item, before)


@pytest.mark.parametrize("bad", [[], [()], [(torch.empty((0, 2)), torch.empty((0, 1)), *task()[2:])],
    [(torch.ones((2, 3)), *task()[1:])], [(task()[0], torch.ones((1, 1)), *task()[2:])],
    [(np.ones((2, 2)), *task()[1:])], [(torch.ones((2, 2), dtype=torch.bool), *task()[1:])],
    [(torch.ones((2, 2), dtype=torch.complex64), *task()[1:])], [task()] * 257])
def test_complete_batch_admission_rejects_before_optimizer_or_rng_changes(bad):
    item = learner()
    before = snapshot(item)
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(MetaTrainingInputError):
        item.meta_train_step(bad)
    unchanged(item, before)
    assert torch.equal(rng, torch.random.get_rng_state())


def test_invalid_later_task_is_admitted_before_first_support_adaptation():
    item = learner()
    bad = list(task())
    bad[3] = torch.full((2, 1), float("nan"))
    before = snapshot(item)
    item.model.train()
    rng = torch.random.get_rng_state().clone()
    with pytest.raises(MetaTrainingInputError):
        item.meta_train_step([task(), tuple(bad)])
    unchanged(item, before)
    assert torch.equal(rng, torch.random.get_rng_state())


def test_unrepresentable_cast_and_batch_work_limit_reject_before_training():
    item = learner()
    bad = list(task())
    bad[0] = torch.full((2, 2), 1e100, dtype=torch.float64)
    with pytest.raises(MetaTrainingInputError):
        item.meta_train_step([tuple(bad)])
    huge = (torch.ones((4096, 2)), torch.ones((4096, 1))) * 2
    with pytest.raises(MetaTrainingInputError):
        item.meta_train_step([huge] * 43)
    assert not item.outer_optimizer.state


def test_scalar_labels_match_columns_and_second_order_gradients_remain_connected():
    left = learner()
    right = learner()
    column = task()
    scalar = (column[0], column[1][:, 0], column[2], column[3][:, 0])
    assert left.meta_train_step([column]) == pytest.approx(right.meta_train_step([scalar]))
    equal(left.model.state_dict(), right.model.state_dict())
    assert all(p.grad is not None and torch.isfinite(p.grad).all() for p in left.model.parameters())


class LinearTask(torch.nn.Linear):
    input_dim = 1
    output_dim = 1


def linear_learner():
    model = LinearTask(1, 1)
    with torch.no_grad():
        model.weight.fill_(0.4)
        model.bias.fill_(0.2)
    return MAML(model, inner_lr=0.1, outer_lr=0.01, device="cpu")


def test_native_higher_order_gradient_and_adam_match_independent_closed_form_reference():
    item = linear_learner()
    reference = linear_learner()
    gradients = [0., 0.]
    losses = []
    tasks = []
    for s, sy, q, qy in [(2., 1., 3., 2.), (-1., 0.3, 0.5, -0.4)]:
        support_error = 0.4 * s + 0.2 - sy
        adapted_w = 0.4 - 0.1 * 2 * support_error * s
        adapted_b = 0.2 - 0.1 * 2 * support_error
        query_error = adapted_w * q + adapted_b - qy
        losses.append(query_error ** 2)
        gradients[0] += 2 * query_error * (q - 0.2 * s * (s * q + 1)) / 2
        gradients[1] += 2 * query_error * (1 - 0.2 * (s * q + 1)) / 2
        tasks.append(tuple(torch.tensor([[v]]) for v in (s, sy, q, qy)))
    for parameter, gradient in zip(reference.model.parameters(), gradients):
        parameter.grad = torch.full_like(parameter, gradient)
    torch.nn.utils.clip_grad_norm_(reference.model.parameters(), 1.0)
    reference.outer_optimizer.step()
    actual_loss = item.meta_train_step(tasks)
    assert actual_loss == pytest.approx(sum(losses) / 2, rel=1e-6)
    for actual, expected in zip(item.model.parameters(), reference.model.parameters()):
        torch.testing.assert_close(actual, expected, rtol=1e-6, atol=1e-7)
    for actual, expected in zip(item.outer_optimizer.state.values(), reference.outer_optimizer.state.values()):
        for key in actual:
            torch.testing.assert_close(actual[key], expected[key], rtol=2e-6, atol=1e-7)


def test_real_adam_unrepresentable_candidate_restores_parameters_optimizer_and_gradients():
    item = linear_learner()
    item.meta_train_step([(torch.tensor([[1.]]),) * 4])
    with torch.no_grad():
        item.model.weight.fill_(1.5e38)
    item.outer_optimizer.param_groups[0]["lr"] = 3.4e38
    before = snapshot(item)
    loss = -item.model.weight.sum() + item.model.bias.sum() * 0
    with pytest.raises(MetaTrainingTransitionError):
        item.outer_update(loss)
    unchanged(item, before)
    item.outer_optimizer.param_groups[0]["lr"] = 0.01
    item.outer_update(item.model.weight.sum() + item.model.bias.sum())
    assert all(torch.isfinite(p).all() for p in item.model.parameters())


@pytest.mark.parametrize("kind", ["loss", "gradient", "support", "query"])
def test_finite_transition_gates_leave_previous_native_generation_intact(kind):
    item = linear_learner()
    item.meta_train_step([(torch.tensor([[1.]]),) * 4])
    before = snapshot(item)
    with pytest.raises(MetaTrainingTransitionError):
        if kind == "loss":
            item.outer_update(item.model.weight.sum() * float("nan") + item.model.bias.sum())
        elif kind == "gradient":
            # sqrt at zero has finite objective but an infinite derivative.
            item.outer_update((item.model.weight - item.model.weight.detach()).sqrt().sum() + item.model.bias.sum())
        elif kind == "support":
            item.meta_train_step([(torch.ones((1, 1)), torch.full((1, 1), 1e30), torch.ones((1, 1)), torch.ones((1, 1)))])
        else:
            item.meta_train_step([(torch.ones((1, 1)), torch.ones((1, 1)), torch.ones((1, 1)), torch.full((1, 1), 1e30))])
    unchanged(item, before)


@pytest.mark.parametrize("policy", [{"num_epochs":0}, {"num_epochs":True}, {"tasks_per_epoch":257},
    {"k_shot":0}, {"num_epochs":1.5}])
def test_full_training_counts_reject_before_generator_is_called(policy):
    item = learner()
    class Generator:
        def sample_tasks(self, *args):
            raise AssertionError("unadmitted request reached generator")
    with pytest.raises(MetaTrainingInputError):
        item.meta_train(Generator(), **policy)


@pytest.fixture
def native_router():
    spec = importlib.util.spec_from_file_location("native_meta_training_routes", ROOT / "routes/meta_routes.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    module.maml = learner()
    app = FastAPI()
    app.include_router(module.router)
    return module, TestClient(app)


@pytest.mark.parametrize("payload", [{"epochs":0},{"epochs":True},{"epochs":1.2}, {"epochs":"1"},
    {"tasks_per_epoch":257},{"k_shot":0}])
def test_actual_train_router_rejects_invalid_counts(native_router, payload):
    _, client = native_router
    assert client.post("/meta/train", json=payload).status_code == 422


def test_actual_train_router_preserves_input_error_vs_internal_transition_failure(native_router):
    module, client = native_router
    class Generator:
        def sample_tasks(self, *args):
            return []
    module.task_generator = Generator()
    response = client.post("/meta/train", json={"epochs":1,"tasks_per_epoch":1,"k_shot":1})
    assert response.status_code == 422
    class NonfiniteModelTask:
        def sample_tasks(self, *args):
            return [(torch.ones((1, 2)), torch.full((1, 1), 1e30), torch.ones((1, 2)), torch.ones((1, 1)))]
    module.task_generator = NonfiniteModelTask()
    assert client.post("/meta/train", json={"epochs":1,"tasks_per_epoch":1,"k_shot":1}).status_code == 500


def test_owned_task_snapshot_survives_caller_mutation_during_native_forward():
    left, right = learner(), learner()
    inputs = task()
    original = tuple(value.clone() for value in inputs)
    mutated = False
    def mutate_caller_inputs(module, arguments):
        nonlocal mutated
        if not mutated:
            mutated = True
            for value in inputs:
                value.fill_(1e30)
    handle = left.model.network[0].register_forward_pre_hook(mutate_caller_inputs)
    try:
        observed = left.meta_train_step([inputs])
    finally:
        handle.remove()
    expected = right.meta_train_step([original])
    assert observed == pytest.approx(expected)
    equal(left.model.state_dict(), right.model.state_dict())


def test_finite_gradient_norm_overflow_restores_actual_adam_transition():
    item = linear_learner()
    item.meta_train_step([(torch.ones((1, 1)),) * 4])
    before = snapshot(item)
    loss = (item.model.weight.sum() + item.model.bias.sum()) * 1e30
    assert torch.isfinite(loss)
    with pytest.raises(MetaTrainingTransitionError):
        item.outer_update(loss)
    unchanged(item, before)
