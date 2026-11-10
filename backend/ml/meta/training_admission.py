"""Admission and native Adam transition checks for the owned MAML generation."""
import copy
import math

import torch


class MetaTrainingInputError(ValueError):
    """The submitted training data/policy does not define a complete task batch."""


class MetaTrainingTransitionError(RuntimeError):
    """The current generation cannot produce a finite native training transition."""


def positive_count(value, name, maximum):
    if type(value) is not int or not 1 <= value <= maximum:
        raise MetaTrainingInputError(f"{name} must be an integer in [1,{maximum}]")
    return value


def admit_tasks(tasks, model):
    if not isinstance(tasks, (list, tuple)) or not 1 <= len(tasks) <= 256:
        raise MetaTrainingInputError("tasks must contain 1–256 complete support/query tasks")
    reference = next(model.parameters())
    owned = []
    total_values = 0
    for task in tasks:
        if not isinstance(task, (list, tuple)) or len(task) != 4:
            raise MetaTrainingInputError("each task must contain support/query features and labels")
        values = []
        for value in task:
            if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
                    or value.is_complex() or value.dtype == torch.bool):
                raise MetaTrainingInputError("task observations must be dense real tensors")
            total_values += value.numel()
            if total_values > 1048576:
                raise MetaTrainingInputError("task batch exceeds 1048576 observation values")
            candidate = value.detach().to(device=reference.device, dtype=reference.dtype).clone()
            if not torch.isfinite(candidate).all():
                raise MetaTrainingInputError("all task observations must be finitely representable")
            values.append(candidate)
        for index in (0, 2):
            features, labels = values[index:index + 2]
            if (features.ndim != 2 or not 1 <= features.shape[0] <= 4096
                    or features.shape[1] != model.input_dim):
                raise MetaTrainingInputError("task features must contain paired nonempty input_dim rows")
            if labels.ndim == 1 and model.output_dim == 1:
                labels = labels[:, None]
            if labels.shape != (features.shape[0], model.output_dim):
                raise MetaTrainingInputError("task labels must match feature rows and output_dim")
            values[index + 1] = labels
        owned.append(tuple(values))
    return tuple(owned)


def finite_tensor(value, name):
    if not torch.isfinite(value).all():
        raise MetaTrainingTransitionError(f"{name} must remain finite")
    return value


def finite_state(model, optimizer):
    for value in model.state_dict().values():
        finite_tensor(value, "model state")
    for entry in optimizer.state.values():
        for value in entry.values():
            if isinstance(value, torch.Tensor):
                finite_tensor(value, "Adam state")
            elif isinstance(value, float) and not math.isfinite(value):
                raise MetaTrainingTransitionError("Adam scalar state must remain finite")


def checked_outer_step(model, optimizer, loss):
    if not isinstance(loss, torch.Tensor) or loss.numel() != 1:
        raise MetaTrainingTransitionError("meta objective must be one scalar tensor")
    finite_tensor(loss, "meta objective")
    finite_state(model, optimizer)
    parameters = tuple(model.parameters())
    try:
        gradients = torch.autograd.grad(loss, parameters)
    except RuntimeError as error:
        raise MetaTrainingTransitionError("meta objective must belong to the active generation") from error
    for gradient in gradients:
        finite_tensor(gradient, "meta gradient")
    # Preserve the actual registered model/optimizer pair and its preexisting gradients.
    weights = copy.deepcopy(model.state_dict())
    moments = copy.deepcopy(optimizer.state_dict())
    previous_gradients = [None if parameter.grad is None else parameter.grad.detach().clone()
                          for parameter in parameters]
    try:
        optimizer.zero_grad()
        for parameter, gradient in zip(parameters, gradients):
            parameter.grad = gradient
        torch.nn.utils.clip_grad_norm_(parameters, 1.0, error_if_nonfinite=True)
        optimizer.step()
        finite_state(model, optimizer)
    except Exception as error:
        model.load_state_dict(weights)
        optimizer.load_state_dict(moments)
        for parameter, gradient in zip(parameters, previous_gradients):
            parameter.grad = gradient
        raise MetaTrainingTransitionError("native MAML/Adam transition rejected and restored") from error
