"""Owned direct classification batches, admitted before native training effects.

Record packing/task selection stays with finetuning; this protects the legacy
standalone trainer's direct tensor entry point without changing its objective.
"""

import torch


def own_classification_batch(batch, model):
    if not isinstance(batch, dict) or not {'input_ids', 'labels'} <= batch.keys():
        raise ValueError('supervised batch requires input_ids and labels')
    ids, labels = batch['input_ids'], batch['labels']
    if (not isinstance(ids, torch.Tensor) or ids.layout != torch.strided
            or ids.dtype != torch.long or ids.ndim != 2 or 0 in ids.shape):
        raise ValueError('input_ids must be nonempty strided int64 [batch, sequence]')
    if ids.size(1) > model.position_encoding.pe.size(0):
        raise ValueError('input_ids exceed positional capacity')
    if not ((ids >= 0) & (ids < model.token_embedding.num_embeddings)).all():
        raise ValueError('input_ids exceed vocabulary')
    keep = batch.get('attention_mask')
    if keep is None:
        keep = torch.ones_like(ids, dtype=torch.bool)
    if (not isinstance(keep, torch.Tensor) or keep.layout != torch.strided
            or keep.shape != ids.shape or not ((keep == 0) | (keep == 1)).all()
            or not keep.bool().any(dim=1).all()):
        raise ValueError('attention_mask must be binary [batch, sequence] with observed rows')
    if (not isinstance(labels, torch.Tensor) or labels.layout != torch.strided
            or labels.dtype != torch.long or labels.shape != (ids.size(0),)
            or not ((labels >= 0) & (labels < model.classification_head.out_features)).all()):
        raise ValueError('labels must be int64 [batch] within classification range')
    device = model.token_embedding.weight.device
    return {
        'input_ids': ids.detach().to(device=device).clone(),
        'attention_mask': keep.detach().to(device=device, dtype=torch.bool).clone(),
        'labels': labels.detach().to(device=device).clone(),
    }
