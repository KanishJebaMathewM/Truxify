import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
import math
import logging

logger = logging.getLogger(__name__)

class PositionalEncoding(nn.Module):
    """Positional encoding for time series"""
    
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
    """Multi-head attention for time series"""
    
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
    """Transformer block for time series"""
    
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

class TimeSeriesTransformer(nn.Module):
    """Transformer for time series forecasting"""
    
    def __init__(
        self,
        input_dim: int = 1,
        d_model: int = 256,
        num_heads: int = 8,
        num_layers: int = 6,
        d_ff: int = 1024,
        seq_len: int = 96,
        pred_len: int = 24,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.d_model = d_model
        self.seq_len = seq_len
        self.pred_len = pred_len
        
        # Input projection
        self.input_proj = nn.Linear(input_dim, d_model)
        
        # Positional encoding
        self.pos_encoding = PositionalEncoding(d_model, seq_len + pred_len)
        
        # Transformer layers
        self.layers = nn.ModuleList([
            TransformerBlock(d_model, num_heads, d_ff, dropout)
            for _ in range(num_layers)
        ])
        
        # Output projection
        self.output_proj = nn.Linear(d_model, pred_len)
        
        # Layer norm
        self.ln_final = nn.LayerNorm(d_model)
        
        logger.info(f"✅ Time Series Transformer initialized with {num_layers} layers")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x shape: (batch_size, seq_len, input_dim)
        
        # Project input
        x = self.input_proj(x)
        
        # Add positional encoding
        x = self.pos_encoding(x)
        
        # Transformer layers
        for layer in self.layers:
            x = layer(x)
        
        # Final layer norm
        x = self.ln_final(x)
        
        # Output projection
        # Take last timestep and project to prediction length
        x = x[:, -1, :]  # (batch_size, d_model)
        x = self.output_proj(x)  # (batch_size, pred_len)
        
        return x

class DemandForecastTransformer(nn.Module):
    """Transformer for demand forecasting"""
    
    def __init__(
        self,
        input_dim: int = 8,
        d_model: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        seq_len: int = 72,
        pred_len: int = 24,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.transformer = TimeSeriesTransformer(
            input_dim=input_dim,
            d_model=d_model,
            num_heads=num_heads,
            num_layers=num_layers,
            seq_len=seq_len,
            pred_len=pred_len,
            dropout=dropout
        )
        
        self.input_dim = input_dim
        self.pred_len = pred_len
        
        logger.info(f"✅ Demand Forecast Transformer initialized")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.transformer(x)

class TrafficForecastTransformer(nn.Module):
    """Transformer for traffic forecasting"""
    
    def __init__(
        self,
        input_dim: int = 5,
        d_model: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        seq_len: int = 48,
        pred_len: int = 12,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.transformer = TimeSeriesTransformer(
            input_dim=input_dim,
            d_model=d_model,
            num_heads=num_heads,
            num_layers=num_layers,
            seq_len=seq_len,
            pred_len=pred_len,
            dropout=dropout
        )
        
        logger.info(f"✅ Traffic Forecast Transformer initialized")

class PriceForecastTransformer(nn.Module):
    """Transformer for price forecasting"""
    
    def __init__(
        self,
        input_dim: int = 6,
        d_model: int = 256,
        num_heads: int = 8,
        num_layers: int = 4,
        seq_len: int = 96,
        pred_len: int = 24,
        dropout: float = 0.1
    ):
        super().__init__()
        
        self.transformer = TimeSeriesTransformer(
            input_dim=input_dim,
            d_model=d_model,
            num_heads=num_heads,
            num_layers=num_layers,
            seq_len=seq_len,
            pred_len=pred_len,
            dropout=dropout
        )
        
        logger.info(f"✅ Price Forecast Transformer initialized")

class TransformerTrainer:
    """Trainer for time series transformers"""
    
    def __init__(
        self,
        model: nn.Module,
        lr: float = 1e-4,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.optimizer = torch.optim.AdamW(model.parameters(), lr=lr)
        self.criterion = nn.MSELoss()
        
        logger.info(f"✅ Transformer Trainer initialized on {self.device}")
    
    def train_step(self, x: torch.Tensor, y: torch.Tensor) -> float:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        x = x.to(self.device)
        y = y.to(self.device)
        
        # Forward pass
        predictions = self.model(x)
        
        # Loss
        loss = self.criterion(predictions, y)
        
        # Backward pass
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        
        return loss.item()
    
    def train(
        self,
        train_data: torch.Tensor,
        train_labels: torch.Tensor,
        epochs: int = 50,
        batch_size: int = 32,
        val_data: Optional[torch.Tensor] = None,
        val_labels: Optional[torch.Tensor] = None
    ) -> Dict:
        """Full training loop"""
        losses = []
        val_losses = []
        
        num_batches = (train_data.size(0) + batch_size - 1) // batch_size
        
        for epoch in range(epochs):
            epoch_loss = 0
            
            # Shuffle data
            indices = torch.randperm(train_data.size(0))
            train_data_shuffled = train_data[indices]
            train_labels_shuffled = train_labels[indices]
            
            for i in range(0, train_data.size(0), batch_size):
                batch_x = train_data_shuffled[i:i+batch_size]
                batch_y = train_labels_shuffled[i:i+batch_size]
                
                loss = self.train_step(batch_x, batch_y)
                epoch_loss += loss
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            # Validation
            if val_data is not None and val_labels is not None:
                val_loss = self.validate(val_data, val_labels)
                val_losses.append(val_loss)
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}, Val Loss={val_loss:.4f}")
            else:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'train_losses': losses,
            'val_losses': val_losses,
            'final_loss': losses[-1] if losses else None,
            'final_val_loss': val_losses[-1] if val_losses else None
        }
    
    def validate(self, x: torch.Tensor, y: torch.Tensor) -> float:
        """Validate model"""
        self.model.eval()
        with torch.no_grad():
            x = x.to(self.device)
            y = y.to(self.device)
            predictions = self.model(x)
            loss = self.criterion(predictions, y)
        return loss.item()
    
    def predict(self, x: torch.Tensor) -> np.ndarray:
        """Make predictions"""
        self.model.eval()
        with torch.no_grad():
            x = x.to(self.device)
            predictions = self.model(x)
        return predictions.cpu().numpy()
    
    def save(self, path: str = "models/transformer_ts.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/transformer_ts.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")