"""Native step admission and recovery within the trainer's generation fence."""

import copy
import math
from contextlib import contextmanager

import torch

MAX_BATCH_VALUES = 2_000_000
MAX_MODEL_VALUES = 8_000_000
MAX_TASKS = 64


class TrainingAdmissionError(ValueError):
    """The complete direct batch or training policy is unsupported."""


class TrainingCandidateError(RuntimeError):
    """Native training produced an inadmissible candidate state."""


def prepare_step(trainer, x, targets, *, validate=None):
    names = tuple(trainer.model.tasks)
    if (not names or len(names) > MAX_TASKS or not isinstance(targets, dict)
            or set(targets) != set(names) or not isinstance(x, torch.Tensor)
            or x.ndim != 2 or not x.numel() or not x.is_floating_point()
            or x.layout != torch.strided or not torch.isfinite(x).all()):
        raise TrainingAdmissionError("invalid complete MTL training batch")
    if (x.dtype != next(trainer.model.parameters()).dtype
            or any(not isinstance(value, torch.Tensor) or value.layout != torch.strided
                   or not value.numel() or not torch.isfinite(value).all()
                   for value in targets.values())):
        raise TrainingAdmissionError("MTL training requires compatible finite tensors")
    if sum(value.numel() for value in [x, *targets.values()]) > MAX_BATCH_VALUES:
        raise TrainingAdmissionError("MTL training batch exceeds its work budget")
    if sum(value.numel() for value in trainer.model.state_dict().values()) > MAX_MODEL_VALUES:
        raise TrainingAdmissionError("MTL training model exceeds its snapshot budget")
    if validate is not None:
        try:
            validate(x, targets, name="training step")
        except ValueError as error:
            raise TrainingAdmissionError(str(error)) from error
    losses = trainer.loss.task_losses
    if (not isinstance(losses, dict) or set(losses) != set(names)
            or not all(callable(value) for value in losses.values())):
        raise TrainingAdmissionError("MTL training losses must exactly match task names")
    policy = trainer.task_weights
    if (not isinstance(policy, dict) or not set(policy) <= set(names)
            or any(type(value) not in (int, float) or not math.isfinite(value) or value < 0
                   for value in policy.values())
            or type(trainer.gradient_method) is not str
            or trainer.gradient_method not in {"pcgrad", "standard", "grad_drop", "mgda"}):
        raise TrainingAdmissionError("invalid MTL training weight or gradient policy")
    weights = {name: policy.get(name, 1.) for name in names}
    # Only owned tensors reach forward/autograd; caller mutation after this
    # snapshot cannot change the admitted batch or weighting policy.
    return (x.detach().clone().to(trainer.device),
            {name: targets[name].detach().clone().to(trainer.device) for name in names},
            weights, trainer.gradient_method)


def require_scalar(value, name):
    if (not isinstance(value, torch.Tensor) or value.numel() != 1
            or not value.is_floating_point() or not torch.isfinite(value).all()):
        raise TrainingCandidateError(f"MTL {name} must be a finite scalar objective")


def require_state(trainer):
    if not isinstance(trainer.optimizer, torch.optim.Adam):
        raise TrainingCandidateError("MTL training requires native Adam")
    if any(not torch.isfinite(value).all() for value in trainer.model.state_dict().values()):
        raise TrainingCandidateError("MTL model candidate must remain finite")
    for group in trainer.optimizer.param_groups:
        for key in ("lr", "eps", "weight_decay"):
            value = group[key]
            if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
                raise TrainingCandidateError("invalid native MTL Adam policy")
        if any(not math.isfinite(value) or not 0 <= value < 1 for value in group["betas"]):
            raise TrainingCandidateError("invalid native MTL Adam beta")
    for entry in trainer.optimizer.state.values():
        for name, value in entry.items():
            if (not isinstance(value, torch.Tensor) or not torch.isfinite(value).all()
                    or (name in {"exp_avg_sq", "max_exp_avg_sq", "step"} and (value < 0).any())):
                raise TrainingCandidateError("MTL Adam candidate must retain finite valid moments")


@contextmanager
def recover_step(trainer):
    """Keep live identities; recover native state/gradients/modes on failure."""
    require_state(trainer)
    model = copy.deepcopy(trainer.model.state_dict())
    optimizer = copy.deepcopy(trainer.optimizer.state_dict())
    gradients = [(parameter, None if parameter.grad is None else parameter.grad.detach().clone())
                 for parameter in trainer.model.parameters()]
    modes = [(module, module.training) for module in trainer.model.modules()]
    try:
        yield
        if any(parameter.grad is not None and not torch.isfinite(parameter.grad).all()
               for parameter in trainer.model.parameters()):
            raise TrainingCandidateError("MTL derivatives must remain finite")
        require_state(trainer)
    except Exception:
        trainer.model.load_state_dict(model, strict=True)
        trainer.optimizer.load_state_dict(optimizer)
        for parameter, gradient in gradients:
            parameter.grad = gradient
        for module, mode in modes:
            module.training = mode
        raise
