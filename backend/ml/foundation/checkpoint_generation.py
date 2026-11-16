"""Paired weights/vocabulary inference artifacts and private runtime restore."""

import copy
import json
import math
import os
import tempfile
from datetime import datetime, timezone
from numbers import Integral
from pathlib import Path

import torch

FORMAT = "truxify.foundation.weights-vocabulary.v1"
MAX_BYTES = 1_073_741_824
MAX_VALUES = 200_000_000
MAX_VOCAB_BYTES = 10_000_000


def checked_vocab(vocab, capacity):
    if (
        not isinstance(vocab, dict)
        or len(vocab) > capacity
        or any(
            not isinstance(word, str) or not word or len(word) > 1024 for word in vocab
        )
        or any(
            isinstance(i, bool) or not isinstance(i, Integral) for i in vocab.values()
        )
        or set(vocab.values()) != set(range(len(vocab)))
    ):
        raise ValueError(
            "vocabulary must be unique contiguous integer IDs within embedding capacity"
        )
    owned = {word: int(index) for word, index in vocab.items()}
    if len(json.dumps(owned).encode()) > MAX_VOCAB_BYTES:
        raise ValueError("vocabulary exceeds the serialized byte budget")
    return owned


def checked_config(values, current):
    if not isinstance(values, dict) or set(values) != set(vars(current)):
        raise ValueError("checkpoint configuration schema differs")
    counts = {
        "vocab_size",
        "d_model",
        "num_heads",
        "num_layers",
        "d_ff",
        "max_len",
        "warmup_steps",
        "batch_size",
        "epochs",
    }
    for key in counts:
        value = values[key]
        lower = 0 if key == "warmup_steps" else 1
        if (
            isinstance(value, bool)
            or not isinstance(value, Integral)
            or not lower <= value <= 1_000_000
        ):
            raise ValueError("checkpoint configuration counts must be bounded integers")
    for key in ("dropout", "learning_rate"):
        value = values[key]
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError("checkpoint configuration policy must be finite")
    if values["dropout"] >= 1:
        raise ValueError("dropout must be in [0,1)")
    for key in (
        "vocab_size",
        "d_model",
        "num_heads",
        "num_layers",
        "d_ff",
        "max_len",
        "dropout",
    ):
        if values[key] != getattr(current, key):
            raise ValueError(
                "checkpoint architecture must match the current service graph"
            )
    candidate = copy.deepcopy(current)
    for key, value in values.items():
        setattr(candidate, key, copy.deepcopy(value))
    return candidate


def checked_weights(values, model):
    expected = model.state_dict()
    if not isinstance(values, dict) or values.keys() != expected.keys():
        raise ValueError("complete checkpoint parameter/buffer keys are required")
    count, size = 0, 0
    for key, value in values.items():
        if (
            type(value) is not torch.Tensor
            or value.layout != torch.strided
            or value.shape != expected[key].shape
            or value.dtype != expected[key].dtype
            or value.dtype not in (torch.float32, torch.float64)
            or not torch.isfinite(value).all()
        ):
            raise ValueError(
                "checkpoint requires complete finite compatible native tensors"
            )
        count += value.numel()
        size += value.numel() * value.element_size()
    if count > MAX_VALUES or size > MAX_BYTES:
        raise ValueError("checkpoint exceeds the model snapshot budget")
    return {key: value.detach().clone() for key, value in values.items()}


def save_bundle(trainer, processor, path):
    """Caller holds its service fence; replace the destination only after success."""
    weights = checked_weights(trainer.model.state_dict(), trainer.model)
    config = checked_config(vars(trainer.config), trainer.config)
    vocab = checked_vocab(processor.vocab, trainer.model.token_embedding.num_embeddings)
    payload = {
        "format": FORMAT,
        "model_state_dict": weights,
        "config": copy.deepcopy(vars(config)),
        "vocab": vocab,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    destination = Path(path)
    destination.parent.mkdir(parents=True, exist_ok=True)
    pending = None
    try:
        with tempfile.NamedTemporaryFile(
            dir=destination.parent,
            prefix=destination.name + ".",
            suffix=".tmp",
            delete=False,
        ) as stream:
            pending = stream.name
            torch.save(payload, stream)
            stream.flush()
            if stream.tell() > MAX_BYTES:
                raise ValueError("serialized checkpoint exceeds its byte budget")
            os.fsync(stream.fileno())
        os.replace(pending, destination)
        pending = None
    finally:
        if pending is not None:
            Path(pending).unlink(missing_ok=True)
    return {"vocabulary_source": "bundled", "training_state": "weights_only"}


def load_bundle(trainer, processor, path, legacy_vocab_path="models/vocab.json"):
    """Return a complete private generation; no caller-owned object is mutated."""
    source = Path(path)
    if source.stat().st_size > MAX_BYTES:
        raise ValueError("serialized checkpoint exceeds its byte budget")
    payload = torch.load(source, map_location=trainer.device, weights_only=True)
    if not isinstance(payload, dict):
        raise TypeError("checkpoint payload must be a dictionary")
    if payload.get("format") == FORMAT:
        raw_vocab = payload.get("vocab")
        provenance = "bundled"
    elif "format" not in payload:
        legacy = Path(legacy_vocab_path)
        if legacy.stat().st_size > MAX_VOCAB_BYTES:
            raise ValueError("legacy vocabulary exceeds its byte budget")
        raw_vocab = json.loads(legacy.read_bytes())
        provenance = "legacy_selected_file"
    else:
        raise ValueError("unknown foundation checkpoint format")
    config = checked_config(payload.get("config"), trainer.config)
    vocab = checked_vocab(raw_vocab, trainer.model.token_embedding.num_embeddings)
    weights = checked_weights(payload.get("model_state_dict"), trainer.model)
    candidate_model = copy.deepcopy(trainer.model)
    candidate_model.load_state_dict(weights, strict=True)
    # Legacy artifacts never contained optimizer/scheduler state. Starting an
    # ordinary fresh trainer avoids reusing moments tied to unrelated weights.
    candidate_trainer = type(trainer)(candidate_model, config)
    candidate_processor = copy.deepcopy(processor)
    candidate_processor.vocab = vocab
    candidate_processor.vocab_size = len(vocab)
    return (
        candidate_trainer,
        candidate_processor,
        {
            "vocabulary_source": provenance,
            "training_state": "fresh_adamw_scheduler",
        },
    )
