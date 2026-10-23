"""Complete owned observed tuples and recoverable native GAT/Adam steps."""

import copy
import math
from contextlib import contextmanager
from numbers import Integral

import torch
from torch_geometric.data import Data


class TrainingAdmissionError(ValueError):
    """Caller observations or requested work are unsupported."""


class TrainingCandidateError(RuntimeError):
    """Native fitting did not produce a finite accepted state."""


def admit_tuple(trainer, data, targets, epochs=1):
    if (
        isinstance(epochs, bool)
        or not isinstance(epochs, Integral)
        or not 1 <= epochs <= 16
    ):
        raise TrainingAdmissionError("epochs must be an integer in [1, 16]")
    if not isinstance(data, Data):
        raise TrainingAdmissionError("provide a native PyG Data tuple")
    x, edges = data.x, data.edge_index
    parameter = next(trainer.model.parameters())
    if (
        not isinstance(x, torch.Tensor)
        or x.layout != torch.strided
        or x.dtype not in (torch.float32, torch.float64)
        or x.dtype != parameter.dtype
        or x.ndim not in (2, 4)
        or not x.numel()
        or not torch.isfinite(x).all()
    ):
        raise TrainingAdmissionError(
            "GAT features must be complete finite float32/64 tensors matching the model"
        )
    batch, nodes, time, features = (
        (1, x.shape[0], 1, x.shape[1]) if x.ndim == 2 else tuple(x.shape)
    )
    expected_features = getattr(trainer.model, "in_features", features)
    if (
        not 1 <= batch <= 64
        or not 1 <= nodes <= 4096
        or not 1 <= time <= 512
        or features != expected_features
    ):
        raise TrainingAdmissionError("GAT training geometry is unsupported")
    if (
        not isinstance(edges, torch.Tensor)
        or edges.layout != torch.strided
        or edges.dtype not in (torch.int32, torch.int64)
        or edges.ndim != 2
        or edges.shape[0] != 2
        or edges.shape[1] > 65536
        or (edges.numel() and (edges.min() < 0 or edges.max() >= nodes))
    ):
        raise TrainingAdmissionError(
            "GAT training requires integer local node topology"
        )
    if (
        not isinstance(targets, torch.Tensor)
        or targets.layout != torch.strided
        or targets.dtype != parameter.dtype
        or not targets.numel()
        or not torch.isfinite(targets).all()
    ):
        raise TrainingAdmissionError(
            "GAT observed targets must be complete finite model-dtype tensors"
        )
    if targets.ndim == 2 and batch == 1:
        targets = targets.unsqueeze(0)
    horizon = getattr(trainer.model, "prediction_horizon", targets.shape[-1])
    if targets.shape != (batch, nodes, horizon):
        raise TrainingAdmissionError("GAT targets must match (batch, nodes, horizon)")
    parameters = sum(v.numel() for v in trainer.model.state_dict().values())
    if (
        x.numel() + targets.numel() > 8_000_000
        or parameters > 4_000_000
        or batch * edges.shape[1] > 1_000_000
        or batch * nodes * time * time > 32_000_000
        or batch * nodes * time * parameters * int(epochs) > 256_000_000
    ):
        raise TrainingAdmissionError("GAT training work exceeds the declared budget")
    return (
        Data(
            x=x.detach().clone().to(trainer.device),
            edge_index=edges.detach().clone().to(trainer.device, dtype=torch.long),
        ),
        targets.detach().clone().to(trainer.device),
    )


def require_state(trainer):
    if type(trainer.optimizer) is not torch.optim.Adam:
        raise TrainingCandidateError("GAT training requires ordinary native Adam")
    try:
        trainer._validate_restored_pair(trainer.model, trainer.optimizer)
        for group in trainer.optimizer.param_groups:
            if any(not math.isfinite(float(v)) for v in group["betas"]):
                raise ValueError("nonfinite beta")
        for entry in trainer.optimizer.state.values():
            step = entry.get("step")
            if step is not None and step.item() != math.floor(step.item()):
                raise ValueError("nonintegral native Adam step")
    except (ValueError, TypeError, RuntimeError) as exc:
        raise TrainingCandidateError("GAT native model/Adam state is invalid") from exc


def finite_objective(predictions, targets, loss):
    if (
        predictions.shape != targets.shape
        or not torch.isfinite(predictions).all()
        or loss.numel() != 1
        or not torch.isfinite(loss).all()
    ):
        raise TrainingCandidateError(
            "GAT native prediction/objective must be finite and shape aligned"
        )


def finite_gradients(model):
    if any(
        p.grad is not None and not torch.isfinite(p.grad).all()
        for p in model.parameters()
    ):
        raise TrainingCandidateError("GAT native gradients must be finite")


@contextmanager
def recover_step(trainer):
    require_state(trainer)
    model, optimizer = trainer.model, trainer.optimizer
    model_state = copy.deepcopy(model.state_dict())
    optimizer_state = copy.deepcopy(optimizer.state_dict())
    gradients = [
        None if p.grad is None else p.grad.detach().clone() for p in model.parameters()
    ]
    modes = [(module, module.training) for module in model.modules()]
    try:
        yield
        require_state(trainer)
    except Exception:
        model.load_state_dict(model_state)
        optimizer.load_state_dict(optimizer_state)
        for parameter, gradient in zip(model.parameters(), gradients):
            parameter.grad = gradient
        raise
    finally:
        for module, mode in modes:
            module.training = mode


@contextmanager
def evaluation_mode(model):
    modes = [(module, module.training) for module in model.modules()]
    try:
        model.eval()
        with torch.no_grad():
            yield
    finally:
        for module, mode in modes:
            module.training = mode


def observed_targets(records, node_ids, horizon, *, dtype, device):
    by_id = {}
    for record in records:
        node_id = record.node_id
        if node_id in by_id:
            raise TrainingAdmissionError("observed target node IDs must be unique")
        values = record.values
        if len(values) != horizon or any(not math.isfinite(v) for v in values):
            raise TrainingAdmissionError(
                "every observed node requires the complete finite forecast horizon"
            )
        by_id[node_id] = list(values)
    if set(by_id) != set(node_ids):
        raise TrainingAdmissionError(
            "observed targets must exactly cover the graph node IDs"
        )
    result = torch.tensor(
        [by_id[node_id] for node_id in node_ids], dtype=dtype, device=device
    )
    if not torch.isfinite(result).all():
        raise TrainingAdmissionError(
            "observed targets are not representable in model dtype"
        )
    return result


def admit_http_work(model, nodes, epochs):
    parameters = sum(v.numel() for v in model.state_dict().values())
    horizon = model.prediction_horizon
    if (
        parameters > 4_000_000
        or nodes * horizon > 8_000_000
        or nodes * parameters * epochs > 256_000_000
    ):
        raise TrainingAdmissionError(
            "observed graph training exceeds the declared work budget"
        )
