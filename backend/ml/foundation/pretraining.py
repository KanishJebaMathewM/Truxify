"""Explicit owned masked-token examples and native pretraining objective."""

import copy
import math
from numbers import Integral, Real
from threading import RLock

import numpy as np
import torch
from torch import nn

from .optimizer_transition import (
    finite_policy_number,
    operation_owned,
    optimizer_transition,
)

IGNORE_INDEX = -100


def _positive_int(value, name):
    if (
        isinstance(value, (bool, np.bool_))
        or not isinstance(value, Integral)
        or value <= 0
    ):
        raise ValueError(f"{name} must be a positive integer")
    return int(value)


def masked_examples(processor, data, mask_probability=0.15, rng=None):
    """Reserve special IDs without reindexing existing words; mask selected tokens."""
    if isinstance(mask_probability, bool) or not isinstance(mask_probability, Real):
        raise ValueError("mask_probability must lie in [0,1]")  # noqa: TRY004 - uniform admission
    if not math.isfinite(mask_probability) or not 0 <= mask_probability <= 1:
        raise ValueError("mask_probability must lie in [0,1]")
    vocab = processor.vocab
    if (
        not isinstance(vocab, dict)
        or any(
            not isinstance(k, str) or isinstance(v, bool) or not isinstance(v, Integral)
            for k, v in vocab.items()
        )
        or sorted(vocab.values()) != list(range(len(vocab)))
    ):
        raise ValueError("vocabulary IDs must be unique and contiguous")
    # Complete source admission precedes vocabulary/RNG mutation.
    owned = copy.deepcopy(list(data))
    texts = []
    for item in owned:
        if not isinstance(item, dict):
            raise ValueError("pretraining records must be dictionaries")  # noqa: TRY004
        fields = [
            item.get(key, "")
            for key in ("origin", "destination", "cargo_type", "route")
        ]
        if any(not isinstance(value, str) for value in fields):
            raise ValueError("pretraining text fields must be strings")
        text = " ".join(fields)
        if not text.strip():
            raise ValueError("pretraining records need at least one token")
        texts.append(text)
    # prepare_sequence lowercases lexical tokens; uppercase special keys cannot
    # collide with their lowercase lexical counterparts or rewrite old IDs.
    for special in ("[PAD]", "[MASK]"):
        if special not in vocab:
            vocab[special] = len(vocab)
    rng = np.random if rng is None else rng
    result = []
    for item, text in zip(owned, texts):
        original = processor.prepare_sequence(text)
        selected = np.asarray(rng.random(len(original))) < mask_probability
        result.append(
            {
                "tokens": [
                    vocab["[MASK]"] if choose else token
                    for token, choose in zip(original, selected)
                ],
                "labels": [
                    token if choose else IGNORE_INDEX
                    for token, choose in zip(original, selected)
                ],
                "pad_id": vocab["[PAD]"],
                "metadata": item,
            }
        )
    return result


def collate_mlm(samples, vocab_size, max_len):
    """Admit a complete batch before building independent padded tensors."""
    vocab_size = _positive_int(vocab_size, "vocab_size")
    max_len = _positive_int(max_len, "max_len")
    owned = copy.deepcopy(list(samples))
    if not owned:
        raise ValueError("MLM batch must not be empty")
    pad_id = None
    for item in owned:
        if not isinstance(item, dict):
            raise ValueError("MLM samples must be dictionaries")  # noqa: TRY004
        tokens, targets, pad = (
            item.get("tokens"),
            item.get("labels"),
            item.get("pad_id"),
        )
        if not isinstance(tokens, (list, tuple)) or not isinstance(
            targets, (list, tuple)
        ):
            raise ValueError("tokens and labels must be sequences")  # noqa: TRY004
        if not 0 < len(tokens) <= max_len or len(targets) != len(tokens):
            raise ValueError(
                "tokens/labels must have equal nonempty lengths within max_len"
            )
        for values, allow_ignore in ((tokens, False), (targets, True), ([pad], False)):
            if any(
                isinstance(v, (bool, np.bool_))
                or not isinstance(v, Integral)
                or not (0 <= v < vocab_size or (allow_ignore and v == IGNORE_INDEX))
                for v in values
            ):
                raise ValueError("token/target/PAD IDs must be in vocabulary range")
        if pad_id is not None and pad != pad_id:
            raise ValueError("MLM samples must share the same PAD identity")
        pad_id = pad
    width = max(len(item["tokens"]) for item in owned)
    ids = torch.full((len(owned), width), pad_id, dtype=torch.long)
    labels = torch.full_like(ids, IGNORE_INDEX)
    attention = torch.zeros_like(ids, dtype=torch.bool)
    for row, item in enumerate(owned):
        length = len(item["tokens"])
        ids[row, :length] = torch.tensor(item["tokens"], dtype=torch.long)
        labels[row, :length] = torch.tensor(item["labels"], dtype=torch.long)
        attention[row, :length] = True
    return {"input_ids": ids, "labels": labels, "attention_mask": attention}


class MaskedTokenTrainer:
    """Separate masked-token optimizer; legacy supervised trainer stays intact."""

    def __init__(self, model, config):
        self._operation_lock = RLock()
        self.model, self.config = model, config
        self.batch_size = _positive_int(config.batch_size, "batch_size")
        self.epochs = _positive_int(config.epochs, "epochs")
        self.max_len = _positive_int(config.max_len, "max_len")
        if self.max_len > model.position_encoding.pe.size(0):
            raise ValueError("max_len exceeds model positional capacity")
        self.vocab_size = model.token_embedding.num_embeddings
        self.device = next(model.parameters()).device
        learning_rate = finite_policy_number(config.learning_rate, "learning_rate")
        if learning_rate < 0:
            raise ValueError("learning_rate must be nonnegative")
        self.optimizer = torch.optim.AdamW(
            model.parameters(), lr=learning_rate, weight_decay=0.01
        )
        self.scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer, T_max=self.epochs
        )

    def _forward_loss(self, batch):
        ids = batch["input_ids"].to(self.device)
        labels = batch["labels"].to(self.device)
        # Model MLM boundary broadcasts this owned public token mask internally.
        mask = batch["attention_mask"].to(self.device)
        logits = self.model(ids, mask, task="mlm")["output"]
        if (
            logits.shape != (*labels.shape, self.vocab_size)
            or not torch.isfinite(logits).all()
        ):
            raise ValueError("MLM logits must have finite token/vocabulary dimensions")
        count = int((labels != IGNORE_INDEX).sum())
        loss = (
            nn.functional.cross_entropy(
                logits.reshape(-1, self.vocab_size),
                labels.reshape(-1),
                ignore_index=IGNORE_INDEX,
                reduction="sum",
            )
            / count
        )
        if not torch.isfinite(loss):
            raise ValueError("MLM objective is not finite")
        return loss, count

    @operation_owned
    def train_step(self, samples):
        batch = collate_mlm(samples, self.vocab_size, self.max_len)
        count = int((batch["labels"] != IGNORE_INDEX).sum())
        if count == 0:
            return {"loss": 0.0, "supervised_tokens": 0}
        with optimizer_transition(self.model, self.optimizer):
            self.model.train()
            self.optimizer.zero_grad(set_to_none=True)
            loss, count = self._forward_loss(batch)
            loss.backward()
            norm = nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
            if not torch.isfinite(norm):
                self.optimizer.zero_grad(set_to_none=True)
                raise ValueError("MLM gradients are not finite")
            self.optimizer.step()
        return {"loss": float(loss.detach()), "supervised_tokens": count}

    @operation_owned
    def validate(self, samples):
        owned = copy.deepcopy(list(samples))
        batches = [
            collate_mlm(owned[i : i + self.batch_size], self.vocab_size, self.max_len)
            for i in range(0, len(owned), self.batch_size)
        ]
        modes = [(module, module.training) for module in self.model.modules()]
        total, count = 0.0, 0
        try:
            self.model.eval()
            with torch.no_grad():
                for batch in batches:
                    if not (batch["labels"] != IGNORE_INDEX).any():
                        continue
                    loss, n = self._forward_loss(batch)
                    total += float(loss) * n
                    count += n
        finally:
            for module, mode in modes:
                module.training = mode
        return total / count if count else 0.0

    @operation_owned
    def train(self, train_data, val_data=None):
        train_data = copy.deepcopy(list(train_data))
        val_data = copy.deepcopy(list(val_data)) if val_data is not None else None
        if not train_data:
            raise ValueError("MLM training data must not be empty")
        # Admit all train/validation records before the first parameter update.
        for dataset in (train_data, val_data or []):
            for item in dataset:
                collate_mlm([item], self.vocab_size, self.max_len)
            if dataset:
                collate_mlm(dataset[: self.batch_size], self.vocab_size, self.max_len)
                if len({item["pad_id"] for item in dataset}) != 1:
                    raise ValueError("MLM dataset must share the same PAD identity")
        losses, val_losses, token_counts = [], [], []
        for _ in range(self.epochs):
            total, count = 0.0, 0
            for i in range(0, len(train_data), self.batch_size):
                result = self.train_step(train_data[i : i + self.batch_size])
                n = result["supervised_tokens"]
                total += result["loss"] * n
                count += n
            losses.append(total / count if count else 0.0)
            token_counts.append(count)
            if count:
                self.scheduler.step()
            if val_data:
                val_losses.append(self.validate(val_data))
        return {
            "train_losses": losses,
            "supervised_tokens_per_epoch": token_counts,
            "val_losses": val_losses,
            "final_train_loss": losses[-1],
            "final_val_loss": val_losses[-1] if val_losses else None,
        }
