import torch
import torch.nn as nn
import torch.nn.functional as F
import math
from typing import Optional, Dict, List, Tuple
import logging

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
        
        if mask is not None:
            scores = scores.masked_fill(mask == 0, -1e9)
        
        attn = F.softmax(scores, dim=-1)
        attn = self.dropout(attn)
        
        # Apply attention
        out = torch.matmul(attn, v)
        out = out.transpose(1, 2).contiguous().view(batch_size, -1, self.d_model)
        out = self.w_o(out)
        
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
        # Embeddings
        x = self.token_embedding(input_ids) * math.sqrt(self.d_model)
        x = self.position_encoding(x)
        x = self.dropout(x)
        
        # Transformer layers
        for layer in self.layers:
            x = layer(x, attention_mask)
        
        x = self.ln_final(x)
        
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
    
    def train_step(self, batch: Dict) -> Dict:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Move to device
        input_ids = batch['input_ids'].to(self.device)
        attention_mask = batch.get('attention_mask')
        if attention_mask is not None:
            attention_mask = attention_mask.to(self.device)
        labels = batch['labels'].to(self.device)
        
        # Forward pass
        outputs = self.model(input_ids, attention_mask, task='classification')
        logits = outputs['output']
        
        # Compute loss
        loss = self.criterion(logits, labels)
        
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        self.scheduler.step()
        
        return {
            'loss': loss.item(),
            'lr': self.optimizer.param_groups[0]['lr']
        }
    
    def train(self, train_data: List[Dict], val_data: Optional[List[Dict]] = None) -> Dict:
        """Full training loop"""
        losses = []
        val_losses = []
        
        for epoch in range(self.config.epochs):
            epoch_loss = 0
            num_batches = 0
            
            # Shuffle data
            import random
            random.shuffle(train_data)
            
            for i in range(0, len(train_data), self.config.batch_size):
                batch = self._prepare_batch(train_data[i:i+self.config.batch_size])
                result = self.train_step(batch)
                epoch_loss += result['loss']
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            # Validation
            if val_data:
                val_loss = self.validate(val_data)
                val_losses.append(val_loss)
                logger.info(f"Epoch {epoch+1}: loss={avg_loss:.4f}, val_loss={val_loss:.4f}")
            else:
                logger.info(f"Epoch {epoch+1}: loss={avg_loss:.4f}")
        
        return {
            'train_losses': losses,
            'val_losses': val_losses,
            'final_train_loss': losses[-1] if losses else None,
            'final_val_loss': val_losses[-1] if val_losses else None
        }
    
    def validate(self, val_data: List[Dict]) -> float:
        """Validate model"""
        self.model.eval()
        total_loss = 0
        num_batches = 0
        
        with torch.no_grad():
            for i in range(0, len(val_data), self.config.batch_size):
                batch = self._prepare_batch(val_data[i:i+self.config.batch_size])
                
                input_ids = batch['input_ids'].to(self.device)
                attention_mask = batch.get('attention_mask')
                if attention_mask is not None:
                    attention_mask = attention_mask.to(self.device)
                labels = batch['labels'].to(self.device)
                
                outputs = self.model(input_ids, attention_mask, task='classification')
                logits = outputs['output']
                
                loss = self.criterion(logits, labels)
                total_loss += loss.item()
                num_batches += 1
        
        return total_loss / num_batches
    
    def _prepare_batch(self, batch_data: List[Dict]) -> Dict:
        """Prepare batch for training"""
        # In production: implement proper batching with padding
        # For now, use fixed length
        max_len = self.config.max_len
        
        input_ids = []
        labels = []
        
        for item in batch_data:
            tokens = item.get('tokens', [])[:max_len]
            if len(tokens) < max_len:
                tokens = tokens + [0] * (max_len - len(tokens))
            input_ids.append(tokens)
            labels.append(item.get('label', 0))
        
        return {
            'input_ids': torch.tensor(input_ids, dtype=torch.long),
            'labels': torch.tensor(labels, dtype=torch.long)
        }
    
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
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        logger.info(f"✅ Model loaded from {path}")