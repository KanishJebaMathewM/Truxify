"""Read-only observed-token inference with owned native mode and result boundaries."""

from numbers import Integral

import torch

MAX_WORK = 2_000_000_000


class PredictionAdmissionError(ValueError):
    """The current vocabulary/observation cannot form an admitted inference plan."""


def plan(model, processor, text, task, max_len):
    if task not in ('classification', 'regression'):
        raise PredictionAdmissionError('task must be classification or regression')
    if not isinstance(text, str) or not 1 <= len(text) <= 10000:
        raise PredictionAdmissionError('text must contain 1..10000 characters')
    words = text.lower().split()
    if not words or len(words) > 4096:
        raise PredictionAdmissionError('text must contain 1..4096 observed words')
    vocab = processor.vocab
    capacity = model.token_embedding.num_embeddings
    if (not isinstance(vocab, dict) or len(vocab) > capacity
            or any(not isinstance(k, str) or not k or len(k) > 1024 for k in vocab)
            or any(isinstance(v, bool) or not isinstance(v, Integral) for v in vocab.values())
            or set(vocab.values()) != set(range(len(vocab)))):
        raise PredictionAdmissionError('prepared vocabulary must have contiguous IDs within embedding capacity')
    # Validate the full request, including any truncated tail, without assigning
    # new random embedding IDs or using ID0 as synthetic padding.
    mapping = {word: int(index) for word, index in vocab.items()}
    if any(word not in mapping for word in words):
        raise PredictionAdmissionError('unknown words require explicit vocabulary preparation/training')
    positional = model.position_encoding.pe.shape[0]
    if (isinstance(max_len, bool) or not isinstance(max_len, Integral)
            or not 1 <= max_len <= positional):
        raise PredictionAdmissionError('max_len must fit the registered positional capacity')
    length = min(len(words), int(max_len))
    width = model.d_model
    layers = len(model.layers)
    feedforward = model.layers[0].feed_forward[0].out_features if layers else 0
    work = layers * (length * (4*width*width + 2*width*feedforward) + length*length*width)
    if work > MAX_WORK:
        raise PredictionAdmissionError('observed inference exceeds the native work policy')
    weight = model.token_embedding.weight
    if weight.dtype not in (torch.float32, torch.float64) or weight.device.type not in ('cpu','cuda'):
        raise PredictionAdmissionError('inference supports native CPU/CUDA float32 or float64')
    ids = torch.tensor([[mapping[word] for word in words[:length]]], dtype=torch.long, device=weight.device)
    return ids, torch.ones_like(ids, dtype=torch.bool)


def predict_text(model, processor, text, task, max_len):
    ids, keep = plan(model, processor, text, task, max_len)
    modes = [(module, module.training) for module in model.modules()]
    try:
        model.eval()
        with torch.no_grad():
            logits = model(ids, keep, task=task)['output']
            expected = (1, 2) if task == 'classification' else (1, 1)
            if (not isinstance(logits, torch.Tensor) or logits.shape != expected
                    or not torch.isfinite(logits).all()):
                raise RuntimeError('native prediction requires finite task-specific logits')
            if task == 'classification':
                probabilities = torch.softmax(logits.double(), dim=-1)[0]
                if not torch.isfinite(probabilities).all():
                    raise RuntimeError('native probabilities must be finite')
                return {'class': int(probabilities.argmax()), 'probabilities': probabilities.cpu().tolist()}
            return {'value': float(logits[0,0])}
    finally:
        for module, mode in modes:
            module.training = mode
