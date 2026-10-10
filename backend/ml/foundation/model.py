import logging
import math
from datetime import datetime
from typing import Dict, List, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from foundation.finetuning import (
    MAX_TOKEN_WORK,
    FinetuningAdmissionError,
    objective,
    own_batch,
    own_records,
    pack,
    policy,
    task_name,
)

logger = logging.getLogger(__name__)

class PositionalEncoding(nn.Module):
    """Positional encoding for transformer"""
    
    def __init__(self, d_model: int, max_len: int = 5000):
        super().__init__()
        
        pe = torch.zeros(max_len, d_model)
        position = torch.arange(0, max_len, dtype=torch.float).unsqueeze(1)
        div_term = torch.exp(torch.arange(0, d_model, 2).float() * (-math.log(10000.0) / d_model))
        
        pe[:, 0::2] = torch.sin(position * div_term)
        pe[:, 1::2] = torch.cos(position * div_term)
        
        self.register_buffer('pe', pe)
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return x + self.pe[:x.size(1), :].unsqueeze(0)

class MultiHeadAttention(nn.Module):
    """Multi-head attention with Flash Attention support"""
    
    def __init__(self, d_model: int, num_heads: int, dropout: float = 0.1):
        super().__init__()
        assert d_model % num_heads == 0
        
        self.d_model = d_model
        self.num_heads = num_heads
        self.d_k = d_model // num_heads
        
        self.w_q = nn.Linear(d_model, d_model)
        self.w_k = nn.Linear(d_model, d_model)
        self.w_v = nn.Linear(d_model, d_model)
        self.w_o = nn.Linear(d_model, d_model)
        self.dropout = nn.Dropout(dropout)
    
    def forward(self, q: torch.Tensor, k: torch.Tensor, v: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        batch_size = q.size(0)
        
        # Linear projections
        q = self.w_q(q).view(batch_size, -1, self.num_heads, self.d_k).transpose(1, 2)
        k = self.w_k(k).view(batch_size, -1, self.num_heads, self.d_k).transpose(1, 2)
        v = self.w_v(v).view(batch_size, -1, self.num_heads, self.d_k).transpose(1, 2)
        
        # Attention scores
        scores = torch.matmul(q, k.transpose(-2, -1)) / math.sqrt(self.d_k)
        
        empty_rows = None
        if mask is not None:
            if mask.device != scores.device:
                raise ValueError("attention mask must be on the input device")
            if not torch.all((mask == 0) | (mask == 1)):
                raise ValueError("attention mask must contain binary keep values")
            if mask.ndim == 2:
                if mask.shape != (batch_size, k.size(-2)):
                    raise ValueError("token mask must have shape [batch, keys]")
                mask = mask[:, None, None, :]
            elif mask.ndim == 3:
                if mask.shape != (batch_size, q.size(-2), k.size(-2)):
                    raise ValueError("pairwise mask must have shape [batch, queries, keys]")
                mask = mask[:, None, :, :]
            elif mask.ndim != 4:
                raise ValueError("attention mask must have rank 2, 3 or 4")
            try:
                keep = torch.broadcast_to(mask.bool(), scores.shape)
            except RuntimeError as exc:
                raise ValueError("attention mask cannot broadcast to [batch, heads, queries, keys]") from exc
            empty_rows = ~keep.any(dim=-1, keepdim=True)
            scores = scores.masked_fill(~keep, float('-inf'))
            # Avoid undefined softmax and its backward derivative for empty rows.
            scores = scores.masked_fill(empty_rows, 0)

        attn = F.softmax(scores, dim=-1)
        if empty_rows is not None:
            attn = attn.masked_fill(empty_rows, 0)
        attn = self.dropout(attn)
        
        # Apply attention
        out = torch.matmul(attn, v)
        out = out.transpose(1, 2).contiguous().view(batch_size, -1, self.d_model)
        out = self.w_o(out)
        if empty_rows is not None:
            out = out.masked_fill(empty_rows.all(dim=1), 0)

        return out

class TransformerBlock(nn.Module):
    """Transformer block with pre-LN"""
    
    def __init__(self, d_model: int, num_heads: int, d_ff: int, dropout: float = 0.1):
        super().__init__()
        
        self.attention = MultiHeadAttention(d_model, num_heads, dropout)
        self.feed_forward = nn.Sequential(
            nn.Linear(d_model, d_ff),
            nn.GELU(),
            nn.Dropout(dropout),
            nn.Linear(d_ff, d_model),
            nn.Dropout(dropout)
        )
        
        self.ln1 = nn.LayerNorm(d_model)
        self.ln2 = nn.LayerNorm(d_model)
    
    def forward(self, x: torch.Tensor, mask: Optional[torch.Tensor] = None) -> torch.Tensor:
        # Pre-LN
        x = x + self.attention(self.ln1(x), self.ln1(x), self.ln1(x), mask)
        x = x + self.feed_forward(self.ln2(x))
        return x

class LogisticsFoundationModel(nn.Module):
    """Foundation model for logistics domain"""
    
    def __init__(
        self,
        vocab_size: int = 50000,
        d_model: int = 768,
        num_heads: int = 12,
        num_layers: int = 12,
        d_ff: int = 3072,
        max_len: int = 1024,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.d_model = d_model
        self.num_layers = num_layers
        
        # Embedding layers
        self.token_embedding = nn.Embedding(vocab_size, d_model)
        self.position_encoding = PositionalEncoding(d_model, max_len)
        self.dropout = nn.Dropout(dropout)
        
        # Transformer blocks
        self.layers = nn.ModuleList([
            TransformerBlock(d_model, num_heads, d_ff, dropout)
            for _ in range(num_layers)
        ])
        
        self.ln_final = nn.LayerNorm(d_model)
        
        # Task-specific heads
        self.classification_head = nn.Linear(d_model, 2)
        self.regression_head = nn.Linear(d_model, 1)
        self.generation_head = nn.Linear(d_model, vocab_size)
        
        logger.info(f"✅ Foundation model initialized with {num_layers} layers, {d_model} dims")
    
    def forward(
        self,
        input_ids: torch.Tensor,
        attention_mask: Optional[torch.Tensor] = None,
        task: str = 'classification'
    ) -> Dict[str, torch.Tensor]:
        if attention_mask is not None:
            if attention_mask.shape != input_ids.shape or attention_mask.ndim != 2:
                raise ValueError("foundation token mask must match [batch, sequence] input IDs")
            if attention_mask.device != input_ids.device:
                raise ValueError("foundation token mask must be on the input device")
            if not torch.all((attention_mask == 0) | (attention_mask == 1)):
                raise ValueError("foundation token mask must contain binary keep values")
            if not attention_mask.bool().any(dim=1).all():
                raise ValueError("foundation token mask requires a non-padding token in every sample")

        # Embeddings
        x = self.token_embedding(input_ids) * math.sqrt(self.d_model)
        x = self.position_encoding(x)
        x = self.dropout(x)
        
        # MLM admits a token mask and broadcasts internally, keeping the public
        # token-mask contract compatible with the separate attention fix.
        layer_mask = attention_mask
        if task == 'mlm' and attention_mask is not None:
            if attention_mask.shape != input_ids.shape or attention_mask.ndim != 2:
                raise ValueError("MLM token mask must match input IDs")
            if attention_mask.device != input_ids.device or not torch.all(
                (attention_mask == 0) | (attention_mask == 1)
            ) or not attention_mask.bool().any(dim=1).all():
                raise ValueError("MLM token mask must be binary, on-device and nonempty per row")
            layer_mask = attention_mask[:, None, None, :]

        # Transformer layers
        for layer in self.layers:
            x = layer(x, layer_mask)
        
        x = self.ln_final(x)
        
        if task == 'mlm':
            return {'output': self.generation_head(x), 'hidden': x}

        # Pooling (mean pooling over sequence)
        if attention_mask is not None:
            x = (x * attention_mask.unsqueeze(-1)).sum(dim=1) / attention_mask.sum(dim=1, keepdim=True)
        else:
            x = x.mean(dim=1)
        
        # Task-specific heads
        if task == 'classification':
            output = self.classification_head(x)
        elif task == 'regression':
            output = self.regression_head(x)
        elif task == 'generation':
            output = self.generation_head(x)
        else:
            output = x
        
        return {'output': output, 'hidden': x}

class FoundationModelConfig:
    """Configuration for foundation model"""
    
    def __init__(
        self,
        vocab_size: int = 50000,
        d_model: int = 768,
        num_heads: int = 12,
        num_layers: int = 12,
        d_ff: int = 3072,
        max_len: int = 1024,
        dropout: float = 0.1,
        learning_rate: float = 1e-4,
        warmup_steps: int = 10000,
        batch_size: int = 32,
        epochs: int = 10
    ):
        self.vocab_size = vocab_size
        self.d_model = d_model
        self.num_heads = num_heads
        self.num_layers = num_layers
        self.d_ff = d_ff
        self.max_len = max_len
        self.dropout = dropout
        self.learning_rate = learning_rate
        self.warmup_steps = warmup_steps
        self.batch_size = batch_size
        self.epochs = epochs

class FoundationModelTrainer:
    """Trainer for foundation model"""
    
    def __init__(self, model: LogisticsFoundationModel, config: FoundationModelConfig):
        self.model = model
        self.config = config
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        self.model.to(self.device)
        
        self.optimizer = torch.optim.AdamW(
            model.parameters(),
            lr=config.learning_rate,
            betas=(0.9, 0.999),
            eps=1e-8,
            weight_decay=0.01
        )
        
        self.scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(
            self.optimizer,
            T_max=config.epochs
        )
        
        self.criterion = nn.CrossEntropyLoss()
        
        logger.info(f"✅ Trainer initialized on {self.device}")
    
    def train_step(self, batch: Dict, task: str = 'classification') -> Dict:
        """One native update using the explicitly selected finetuning objective."""
        batch = own_batch(batch, self.model, self.config, task)
        self.model.train()
        self.optimizer.zero_grad()
        output = self.model(batch['input_ids'], batch['attention_mask'], task=task)['output']
        loss = objective(output, batch['labels'], task)
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        self.scheduler.step()
        return {'loss': loss.item(), 'lr': self.optimizer.param_groups[0]['lr']}

    def train(self, train_data: List[Dict], val_data: Optional[List[Dict]] = None,
              task: str = 'classification', epochs: Optional[int] = None) -> Dict:
        """Admit both complete collections before the first native update."""
        import random

        task_name(task)
        length, batch_size, epochs = policy(self.model, self.config, epochs)
        train_data = own_records(train_data, self.model, length, task)
        val_data = own_records([] if val_data is None else val_data, self.model, length, task, allow_empty=True)
        # Conservative padded-token bound, not a promise of runtime or attention FLOPs.
        if (len(train_data) + len(val_data)) * length * epochs > MAX_TOKEN_WORK:
            raise FinetuningAdmissionError('finetuning exceeds padded-token work budget')
        losses, val_losses = [], []
        for _ in range(epochs):
            random.shuffle(train_data)
            total, samples = 0.0, 0
            for start in range(0, len(train_data), batch_size):
                records = train_data[start:start + batch_size]
                result = self.train_step(pack(records, self.model, task), task=task)
                total += result['loss'] * len(records)
                samples += len(records)
            losses.append(total / samples)
            if val_data:
                val_losses.append(self.validate(val_data, task=task))
        return {
            'train_losses': losses, 'val_losses': val_losses,
            'final_train_loss': losses[-1],
            'final_val_loss': val_losses[-1] if val_losses else None,
        }

    def validate(self, val_data: List[Dict], task: str = 'classification') -> float:
        length, batch_size, _ = policy(self.model, self.config)
        records = own_records(val_data, self.model, length, task)
        modes = [(module, module.training) for module in self.model.modules()]
        total = 0.0
        try:
            self.model.eval()
            with torch.no_grad():
                for start in range(0, len(records), batch_size):
                    subset = records[start:start + batch_size]
                    batch = own_batch(pack(subset, self.model, task), self.model, self.config, task)
                    output = self.model(batch['input_ids'], batch['attention_mask'], task=task)['output']
                    total += objective(output, batch['labels'], task).item() * len(subset)
        finally:
            for module, training in modes:
                module.training = training
        return total / len(records)

    def _prepare_batch(self, batch_data: List[Dict], task: str = 'classification') -> Dict:
        length, batch_size, _ = policy(self.model, self.config)
        if len(batch_data) > batch_size:
            raise FinetuningAdmissionError('records exceed batch_size')
        return pack(own_records(batch_data, self.model, length, task), self.model, task)

    def save(self, path: str = "models/foundation_model.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'config': self.config.__dict__,
            'timestamp': datetime.now().isoformat()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/foundation_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device, weights_only=True)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        logger.info(f"✅ Model loaded from {path}")
