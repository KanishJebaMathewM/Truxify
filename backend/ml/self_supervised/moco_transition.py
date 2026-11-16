"""Admitted native MoCo forward candidates; publication follows finite objective."""

import math

import torch
from torch.func import functional_call

MAX_VALUES = 8_000_000
MAX_LOGITS = 64_000_000


def normalize_features(values):
    """Native L2 normalization with epsilon semantics and detached safe scaling."""
    if not torch.isfinite(values).all():
        raise ValueError('encoder features must be finite')
    work = values.float() if values.dtype in (torch.float16, torch.bfloat16) else values
    scale = work.detach().abs().amax(dim=1, keepdim=True)
    scaled = work / torch.where(scale > 0, scale, torch.ones_like(scale))
    norm = torch.linalg.vector_norm(scaled, dim=1, keepdim=True).clamp_min(1)
    use_unit = scale >= 1e-12 / norm
    # Do not evaluate huge values / epsilon in the unused small-norm branch.
    small = torch.where(use_unit, torch.zeros_like(work), work) / 1e-12
    return torch.where(use_unit, scaled / norm, small)


def _finite_tensor(value, name, dtype, device):
    if (not isinstance(value, torch.Tensor) or value.layout != torch.strided
            or value.dtype != dtype or value.device != device or not torch.isfinite(value).all()):
        raise ValueError(f'{name} must be a finite strided tensor matching the encoder')


def forward_candidate(model, x_q, x_k):
    parameter = next(model.query_encoder.parameters())
    dtype, device = parameter.dtype, parameter.device
    if device.type not in ('cpu', 'cuda'):
        raise ValueError('MoCo candidate supports CPU and CUDA tensor state')
    if dtype not in (torch.float16, torch.bfloat16, torch.float32, torch.float64):
        raise ValueError('MoCo encoder requires supported real floating dtype')
    for name, value in (('query view', x_q), ('key view', x_k)):
        _finite_tensor(value, name, dtype, device)
    if (x_q.ndim != 2 or x_k.shape != x_q.shape or not x_q.size(0)
            or x_q.size(1) != model.input_dim or x_q.numel() > MAX_VALUES):
        raise ValueError('MoCo views require bounded matching nonempty [batch, input_dim] tensors')
    if (isinstance(model.queue_size, bool) or not isinstance(model.queue_size, int)
            or model.queue_size < 1 or model.queue.numel() > MAX_VALUES
            or model.queue.shape != (model.projection_dim, model.queue_size)):
        raise ValueError('MoCo dictionary geometry exceeds admitted capacity')
    _finite_tensor(model.queue, 'dictionary', dtype, device)
    if (model.queue_ptr.shape != (1,) or model.queue_ptr.dtype != torch.long
            or model.queue_ptr.device != device):
        raise ValueError('queue pointer must be a native one-element int64 buffer')
    pointer = int(model.queue_ptr.item())
    if not 0 <= pointer < model.queue_size:
        raise ValueError('queue pointer is outside capacity')
    if x_q.size(0) * model.projection_dim > MAX_VALUES:
        raise ValueError('MoCo projected observations exceed feature budget')
    if x_q.size(0) * (model.queue_size + 1) > MAX_LOGITS:
        raise ValueError('MoCo contrastive candidate exceeds logit budget')
    for name, value, low, high in [('momentum', model.momentum, 0, 1),
                                   ('temperature', model.temperature, 0, None)]:
        if (isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value)
                or value < low or (high is not None and value > high)
                or (name == 'temperature' and value == 0)):
            raise ValueError(f'{name} is outside the finite admitted policy')
    momentum, temperature = model.momentum, model.temperature
    query = dict(model.query_encoder.named_parameters())
    keys = dict(model.key_encoder.named_parameters())
    if query.keys() != keys.keys() or sum(p.numel() for p in query.values()) > MAX_VALUES:
        raise ValueError('momentum encoder topology or parameter budget does not match')
    for name, key in keys.items():
        _finite_tensor(query[name], 'query parameter', dtype, device)
        _finite_tensor(key, 'key parameter', dtype, device)
        if key.shape != query[name].shape or key.requires_grad:
            raise ValueError('momentum keys must be frozen and match query parameter shapes')
    # Owned observations and dictionary; native functional encoding leaves keys untouched.
    x_q, x_k = x_q.clone(), x_k.detach().clone()
    dictionary = model.queue.detach().clone()
    with torch.no_grad():
        candidate = {}
        for name, key in keys.items():
            if not model.training or momentum == 1:
                value = key.detach().clone()
            elif momentum == 0:
                value = query[name].detach().clone()
            else:
                # A float64 accumulator avoids binary32 weighted-sum overflow.
                work_dtype = torch.float64 if dtype != torch.float64 else dtype
                value = (key.to(work_dtype) * momentum
                         + query[name].detach().to(work_dtype) * (1 - momentum)).to(dtype)
            if not torch.isfinite(value).all():
                raise ValueError('momentum candidate is not finitely representable')
            candidate[name] = value
        k = normalize_features(functional_call(model.key_encoder, candidate, (x_k,), strict=True))
    q = normalize_features(model.query_encoder(x_q))
    # Half-precision observations use promoted objective arithmetic and native gradients.
    positive = torch.einsum('nc,nc->n', q, k).unsqueeze(-1) / temperature
    negative = torch.einsum('nc,ck->nk', q, dictionary.to(q.dtype)) / temperature
    logits = torch.cat([positive, negative], dim=1)
    if not torch.isfinite(logits).all():
        raise ValueError('MoCo candidate logits must be finitely representable')
    loss = torch.nn.functional.cross_entropy(logits, torch.zeros(len(q), dtype=torch.long, device=device))
    if not torch.isfinite(loss):
        raise ValueError('MoCo candidate objective must be finite')
    # Prepare the complete circular transition before registered publication.
    count, capacity = len(k), model.queue_size
    retained = min(count, capacity)
    start = (pointer + count - retained) % capacity
    indices = (torch.arange(retained, device=device) + start) % capacity
    with torch.no_grad():
        next_dictionary = dictionary.clone()
        next_dictionary.index_copy_(1, indices, k[-retained:].T.to(dtype))
        if model.training:
            for name, key in keys.items():
                key.copy_(candidate[name])
            model.queue.copy_(next_dictionary)
            model.queue_ptr[0] = (pointer + count) % capacity
    return loss
