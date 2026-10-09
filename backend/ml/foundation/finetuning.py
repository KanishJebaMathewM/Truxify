"""Owned observation admission for the native foundation finetuning pipeline."""

import math
from numbers import Integral, Real

import torch


class FinetuningAdmissionError(ValueError):
    """Client observation or invocation policy cannot enter native finetuning."""


TASKS = ('classification', 'regression')
MAX_RECORDS = 50_000
MAX_TOKENS = 2_000_000
MAX_TOKEN_WORK = 100_000_000


def task_name(task):
    if not isinstance(task, str) or task not in TASKS:
        raise FinetuningAdmissionError('finetuning task must be classification or regression')
    return task


def positive_count(value, name, maximum):
    if isinstance(value, bool) or not isinstance(value, Integral) or not 1 <= value <= maximum:
        raise FinetuningAdmissionError(f'{name} must be an integer in [1, {maximum}]')
    return int(value)


def policy(model, config, epochs=None):
    length = positive_count(config.max_len, 'max_len', 4096)
    if length > model.position_encoding.pe.size(0):
        raise FinetuningAdmissionError('max_len exceeds the model positional capacity')
    batch_size = positive_count(config.batch_size, 'batch_size', 8192)
    epochs = positive_count(config.epochs if epochs is None else epochs, 'epochs', 100)
    return length, batch_size, epochs


def own_records(records, model, length, task, allow_empty=False):
    task_name(task)
    if not isinstance(records, (list, tuple)) or len(records) > MAX_RECORDS:
        raise FinetuningAdmissionError('records must be a bounded list or tuple')
    if not records and not allow_empty:
        raise FinetuningAdmissionError('records must contain at least one observation')
    owned = []
    total = 0
    vocab = model.token_embedding.num_embeddings
    classes = model.classification_head.out_features
    dtype = model.regression_head.weight.dtype
    for item in records:
        if not isinstance(item, dict) or 'tokens' not in item or 'label' not in item:
            raise FinetuningAdmissionError('each observation requires tokens and label')
        tokens = item['tokens']
        if not isinstance(tokens, (list, tuple)) or not tokens:
            raise FinetuningAdmissionError('tokens must be a nonempty list or tuple')
        total += len(tokens)
        if total > MAX_TOKENS:
            raise FinetuningAdmissionError('record collection exceeds token admission budget')
        # Validate the complete sequence, including the subsequently truncated tail.
        for token in tokens:
            if isinstance(token, bool) or not isinstance(token, Integral) or not 0 <= token < vocab:
                raise FinetuningAdmissionError('tokens must be integer IDs within the model vocabulary')
        label = item['label']
        if task == 'classification':
            if isinstance(label, bool) or not isinstance(label, Integral) or not 0 <= label < classes:
                raise FinetuningAdmissionError('classification label must be an in-range integer class')
            label = int(label)
        else:
            if isinstance(label, bool) or not isinstance(label, Real) or not math.isfinite(label):
                raise FinetuningAdmissionError('regression label must be a finite real value')
            label = float(label)
            if not torch.isfinite(torch.tensor(label, dtype=dtype)):
                raise FinetuningAdmissionError('regression label is not representable by the model dtype')
        owned.append({'tokens': tuple(int(t) for t in tokens[:length]), 'label': label})
    return owned


def pack(records, model, task):
    """Mask by observed length: a genuine ID zero remains a real observation."""
    width = max(len(item['tokens']) for item in records)
    ids = torch.zeros((len(records), width), dtype=torch.long)
    keep = torch.zeros_like(ids, dtype=torch.bool)
    for row, item in enumerate(records):
        size = len(item['tokens'])
        ids[row, :size] = torch.tensor(item['tokens'], dtype=torch.long)
        keep[row, :size] = True
    labels = [item['label'] for item in records]
    if task == 'classification':
        labels = torch.tensor(labels, dtype=torch.long)
    else:
        labels = torch.tensor(labels, dtype=model.regression_head.weight.dtype).reshape(-1, 1)
    return {'input_ids': ids, 'attention_mask': keep, 'labels': labels}


def own_batch(batch, model, config, task):
    task_name(task)
    length, batch_size, _ = policy(model, config)
    if not isinstance(batch, dict) or 'input_ids' not in batch or 'labels' not in batch:
        raise FinetuningAdmissionError('batch requires input_ids and labels')
    ids, labels = batch['input_ids'], batch['labels']
    if not isinstance(ids, torch.Tensor) or ids.layout != torch.strided or ids.dtype != torch.long:
        raise FinetuningAdmissionError('input_ids must be a strided int64 tensor')
    if ids.ndim != 2 or not 1 <= ids.size(0) <= batch_size or not 1 <= ids.size(1) <= length:
        raise FinetuningAdmissionError('input_ids exceed admitted batch/sequence geometry')
    if ids.numel() > MAX_TOKENS or not ((ids >= 0) & (ids < model.token_embedding.num_embeddings)).all():
        raise FinetuningAdmissionError('input_ids exceed token budget or vocabulary')
    keep = batch.get('attention_mask')
    if keep is None:
        keep = torch.ones_like(ids, dtype=torch.bool)
    if not isinstance(keep, torch.Tensor) or keep.layout != torch.strided or keep.shape != ids.shape:
        raise FinetuningAdmissionError('attention_mask must match input_ids')
    if not ((keep == 0) | (keep == 1)).all() or not keep.bool().any(dim=1).all():
        raise FinetuningAdmissionError('attention_mask must be binary and nonempty per row')
    if not isinstance(labels, torch.Tensor) or labels.layout != torch.strided:
        raise FinetuningAdmissionError('labels must be a strided tensor')
    if task == 'classification':
        if labels.dtype != torch.long or labels.shape != (ids.size(0),):
            raise FinetuningAdmissionError('classification labels must be int64 [batch]')
        if not ((labels >= 0) & (labels < model.classification_head.out_features)).all():
            raise FinetuningAdmissionError('classification labels exceed class range')
        dtype = torch.long
    else:
        if not labels.is_floating_point() or labels.shape != (ids.size(0), 1) or not torch.isfinite(labels).all():
            raise FinetuningAdmissionError('regression labels must be finite floating [batch, 1]')
        dtype = model.regression_head.weight.dtype
    device = model.token_embedding.weight.device
    labels = labels.detach().to(device=device, dtype=dtype).clone()
    if task == 'regression' and not torch.isfinite(labels).all():
        raise FinetuningAdmissionError('regression labels are not representable by the model dtype')
    return {
        'input_ids': ids.detach().to(device=device).clone(),
        'attention_mask': keep.detach().to(device=device, dtype=torch.bool).clone(),
        'labels': labels,
    }


def objective(output, labels, task):
    return (torch.nn.functional.cross_entropy(output, labels) if task == 'classification'
            else torch.nn.functional.mse_loss(output, labels))
