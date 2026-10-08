"""Native AdamW overflow, independent successful update and recovery controls."""

import copy
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import numpy as np
import pytest
import torch
from foundation.model import FoundationModelConfig, LogisticsFoundationModel
from foundation.pretraining import MaskedTokenTrainer


def setup(lr=1e-4):
    torch.manual_seed(91)
    config = FoundationModelConfig(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=1,
        d_ff=16,
        max_len=6,
        dropout=0,
        epochs=1,
        batch_size=2,
        learning_rate=lr,
    )
    model = LogisticsFoundationModel(
        vocab_size=16,
        d_model=8,
        num_heads=2,
        num_layers=1,
        d_ff=16,
        max_len=6,
        dropout=0,
    )
    return model, MaskedTokenTrainer(model, config)


def records():
    return [{"tokens": [1, 2], "labels": [3, 4], "pad_id": 0}]


def snapshot(model, trainer):
    return (
        copy.deepcopy(model.state_dict()),
        copy.deepcopy(trainer.optimizer.state_dict()),
        [None if p.grad is None else p.grad.clone() for p in model.parameters()],
        [module.training for module in model.modules()],
        copy.deepcopy(trainer.scheduler.state_dict()),
    )


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0, equal_nan=True)
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


@pytest.mark.parametrize("lr", [float("inf"), float("nan"), -1.0, True, "0.1"])
def test_invalid_config_rejected_before_any_model_or_optimizer_work(lr):
    with pytest.raises(ValueError):
        setup(lr)


@pytest.mark.parametrize(
    "field,value",
    [
        ("lr", float("inf")),
        ("lr", float("nan")),
        ("weight_decay", float("inf")),
        ("eps", float("nan")),
        ("betas", (0.9, 1.0)),
        ("betas", (float("nan"), 0.999)),
    ],
)
def test_invalid_runtime_policy_preserves_all_prior_native_state(field, value):
    model, trainer = setup()
    trainer.train_step(records())
    model.eval()
    trainer.optimizer.param_groups[0][field] = value
    before = snapshot(model, trainer)
    with pytest.raises(ValueError):
        trainer.train_step(records())
    # NaN scalar policy is intentionally retained for caller correction.
    after = snapshot(model, trainer)
    equal(after[0], before[0])
    equal(after[2:], before[2:])
    equal(after[1]["state"], before[1]["state"])


def test_huge_finite_native_adamw_step_restores_parameters_moments_gradients_and_modes():
    model, trainer = setup()
    trainer.train_step(records())
    model.eval()
    model.layers[0].train()
    for p in model.parameters():
        p.grad = torch.full_like(p, 0.003)
    trainer.optimizer.param_groups[0]["lr"] = 1e308
    before = snapshot(model, trainer)
    with pytest.raises(ValueError, match="nonfinite"):
        trainer.train_step(records())
    equal(snapshot(model, trainer), before)
    assert all(torch.isfinite(p).all() for p in model.parameters())


def manual_step(model, optimizer):
    model.train()
    optimizer.zero_grad(set_to_none=True)
    logits = model(torch.tensor([[1, 2]]), torch.tensor([[True, True]]), task="mlm")[
        "output"
    ][0]
    targets = torch.tensor([3, 4])
    objective = torch.nn.CrossEntropyLoss()(logits, targets)
    objective.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
    optimizer.step()
    return float(objective.detach())


def test_successful_native_math_and_corrected_retry_match_independent_adamw():
    model, trainer = setup()
    reference = copy.deepcopy(model)
    optimizer = torch.optim.AdamW(reference.parameters(), lr=1e-4, weight_decay=0.01)
    expected_loss = manual_step(reference, optimizer)
    result = trainer.train_step(records())
    assert result["loss"] == pytest.approx(expected_loss)
    for key, value in model.state_dict().items():
        torch.testing.assert_close(
            value, reference.state_dict()[key], rtol=1e-6, atol=1e-7
        )
    trainer.optimizer.param_groups[0]["lr"] = 1e308
    with pytest.raises(ValueError):
        trainer.train_step(records())
    trainer.optimizer.param_groups[0]["lr"] = 1e-4
    result = trainer.train_step(records())
    expected_loss = manual_step(reference, optimizer)
    assert result["loss"] == pytest.approx(expected_loss)
    for key, value in model.state_dict().items():
        torch.testing.assert_close(
            value, reference.state_dict()[key], rtol=1e-6, atol=1e-7
        )
    equal(
        trainer.optimizer.state_dict()["state"].keys(),
        optimizer.state_dict()["state"].keys(),
    )
    for left, right in zip(trainer.optimizer.state.values(), optimizer.state.values()):
        for key in left:
            torch.testing.assert_close(left[key], right[key], rtol=1e-5, atol=1e-7)


@pytest.mark.parametrize(
    "kind", ["raise_after_step", "parameter_nan", "buffer_nan", "moment_inf"]
)
def test_fault_after_actual_adamw_restores_every_native_state(kind, monkeypatch):
    model, trainer = setup()
    trainer.train_step(records())
    model.eval()
    before = snapshot(model, trainer)
    native_step = trainer.optimizer.step

    def faulty(*args, **kwargs):
        result = native_step(*args, **kwargs)
        if kind == "raise_after_step":
            raise RuntimeError("injected after real native optimizer")
        if kind == "parameter_nan":
            with torch.no_grad():
                next(model.parameters()).fill_(float("nan"))
        elif kind == "buffer_nan":
            next(model.buffers()).fill_(float("nan"))
        else:
            next(iter(trainer.optimizer.state.values()))["exp_avg"].fill_(float("inf"))
        return result

    monkeypatch.setattr(trainer.optimizer, "step", faulty)
    with pytest.raises((ValueError, RuntimeError)):
        trainer.train_step(records())
    equal(snapshot(model, trainer), before)


def test_validation_waits_for_actual_native_optimizer_transition(monkeypatch):
    model, trainer = setup()
    model.eval()
    entered, release, validation_started = Event(), Event(), Event()
    native_step = trainer.optimizer.step

    def held_step(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return native_step(*args, **kwargs)

    monkeypatch.setattr(trainer.optimizer, "step", held_step)

    def validate():
        validation_started.set()
        return trainer.validate(records())

    with ThreadPoolExecutor(max_workers=2) as pool:
        update = pool.submit(trainer.train_step, records())
        assert entered.wait(10)
        validation = pool.submit(validate)
        assert validation_started.wait(10)
        assert not validation.done()
        release.set()
        assert update.result(timeout=15)["supervised_tokens"] == 2
        assert np.isfinite(validation.result(timeout=15))
    assert model.training


def test_zero_supervision_does_not_touch_native_state_or_policy():
    model, trainer = setup()
    model.eval()
    trainer.optimizer.param_groups[0]["lr"] = float("inf")
    before = snapshot(model, trainer)
    result = trainer.train_step([{"tokens": [1], "labels": [-100], "pad_id": 0}])
    assert result == {"loss": 0.0, "supervised_tokens": 0}
    equal(snapshot(model, trainer), before)
