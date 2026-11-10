"""Complete owned native graph observations and replicated attention admission."""

import torch


class GATGraphInputError(ValueError):
    """The submitted graph cannot enter native spatial/temporal execution."""


class GATGraphTransitionError(RuntimeError):
    """Native graph execution did not produce finite compatible predictions."""


def graph_policy(model, batch, nodes, steps, edges):
    if not 1 <= batch <= 64 or not 1 <= nodes <= 4096 or not 1 <= steps <= 128 or edges < 0:
        raise GATGraphInputError('graph batch/node/time geometry exceeds admitted capacity')
    if batch * nodes * steps * model.in_features > 2000000 or 2 * batch * edges > 2000000:
        raise GATGraphInputError('graph features or replicated edge indices exceed admitted values')
    if batch * nodes * model.num_heads * steps * steps > 32000000:
        raise GATGraphInputError('complete native temporal attention exceeds admitted values')
    if batch * nodes * steps * max(model.hidden_features, model.out_features) > 8000000:
        raise GATGraphInputError('complete native spatial features exceed admitted values')
    parameters = sum(p.numel() for p in model.parameters())
    if batch * nodes * steps * parameters + batch * steps * edges * model.hidden_features > 256000000:
        raise GATGraphInputError('native graph point/parameter/edge work exceeds admitted capacity')


def admit_graph(model, x, edges, time_features=None):
    if time_features is not None:
        raise GATGraphInputError('extra time_features are unsupported; encode observations in the feature sequence')
    if (not isinstance(x, torch.Tensor) or x.layout != torch.strided or not x.is_floating_point()
            or x.ndim not in (2, 4)):
        raise GATGraphInputError('GAT features require dense floating node rows or batch/node/time rows')
    if x.ndim == 2:
        x = x[None, :, None, :]
    batch, nodes, steps, features = x.shape
    if features != model.in_features:
        raise GATGraphInputError(f'Expected feature dimension {model.in_features}, got {features}')
    if (not isinstance(edges, torch.Tensor) or edges.layout != torch.strided
            or edges.dtype not in (torch.int32, torch.int64) or edges.ndim != 2 or edges.shape[0] != 2):
        raise GATGraphInputError('edge_index requires dense integer local topology shaped [2,edges]')
    graph_policy(model, batch, nodes, steps, edges.shape[1])
    parameter = next(model.parameters())
    if parameter.dtype not in (torch.float32, torch.float64) or parameter.device.type not in ('cpu', 'cuda'):
        raise GATGraphTransitionError('native GAT serving requires float32/64 CPU or CUDA')
    if x.dtype != parameter.dtype or x.device != parameter.device or not torch.isfinite(x).all():
        raise GATGraphInputError('features must be finite and match native model dtype/device')
    if edges.numel() and (edges.min().item() < 0 or edges.max().item() >= nodes):
        raise GATGraphInputError('edge_index must reference nodes in each input graph')
    # Clone before any message-passing callback: topology is never rounded or
    # reinterpreted and differentiable feature links remain connected.
    return x.clone(), edges.to(device=parameter.device, dtype=torch.long).clone()


def predictions(model, value, batch, nodes):
    if (not isinstance(value, torch.Tensor) or value.shape != (batch, nodes, model.prediction_horizon)
            or not torch.isfinite(value).all()):
        raise GATGraphTransitionError('native GAT predictions must be finite paired batch/node/horizon rows')
    return value
