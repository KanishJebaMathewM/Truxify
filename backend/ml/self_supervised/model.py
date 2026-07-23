import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Optional
import math
import logging

logger = logging.getLogger(__name__)

class SimCLR(nn.Module):
    """SimCLR: Simple Contrastive Learning of Visual Representations"""
    
    def __init__(self, input_dim: int = 512, hidden_dim: int = 256, projection_dim: int = 128):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.projection_dim = projection_dim
        
        # Encoder (backbone)
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU()
        )
        
        # Projection head
        self.projection = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, projection_dim)
        )
        
        # Temperature parameter
        self.temperature = 0.5
        
        logger.info(f"✅ SimCLR initialized with {input_dim}->{hidden_dim}->{projection_dim}")
    
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        # Encode
        h = self.encoder(x)
        
        # Project
        z = self.projection(h)
        
        # Normalize
        z = F.normalize(z, dim=1)
        
        return h, z
    
    def contrastive_loss(self, z_i: torch.Tensor, z_j: torch.Tensor) -> torch.Tensor:
        """Compute NT-Xent loss (contrastive loss)"""
        batch_size = z_i.size(0)
        
        # Concatenate representations
        z = torch.cat([z_i, z_j], dim=0)
        
        # Compute similarity matrix
        sim = torch.matmul(z, z.T) / self.temperature
        
        # Create mask
        mask = torch.eye(2 * batch_size, device=z.device)
        sim = sim - mask * 1e9
        
        # Positive pairs: i -> i+batch, i+batch -> i
        positives = torch.cat([
            torch.diag(sim, batch_size),
            torch.diag(sim, -batch_size)
        ]).reshape(2 * batch_size, 1)
        
        # Negative pairs
        negatives = sim[~mask.bool()].reshape(2 * batch_size, -1)
        
        # Log-sum-exp
        logits = torch.cat([positives, negatives], dim=1)
        loss = -F.log_softmax(logits, dim=1)[:, 0].mean()
        
        return loss

class MoCo(nn.Module):
    """MoCo: Momentum Contrast for Unsupervised Visual Representation Learning"""
    
    def __init__(
        self,
        input_dim: int = 512,
        hidden_dim: int = 256,
        projection_dim: int = 128,
        queue_size: int = 4096,
        momentum: float = 0.999
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.projection_dim = projection_dim
        self.queue_size = queue_size
        self.momentum = momentum
        
        # Query encoder
        self.query_encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, projection_dim)
        )
        
        # Key encoder (momentum)
        self.key_encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, projection_dim)
        )
        
        # Initialize key encoder with query encoder
        self._momentum_update_key_encoder(1.0)
        
        # Queue
        self.register_buffer('queue', torch.randn(projection_dim, queue_size))
        self.queue = F.normalize(self.queue, dim=0)
        self.register_buffer('queue_ptr', torch.zeros(1, dtype=torch.long))
        
        # Temperature
        self.temperature = 0.5
        
        logger.info(f"✅ MoCo initialized with queue size {queue_size}")
    
    def _momentum_update_key_encoder(self, momentum: float):
        """Momentum update of key encoder"""
        for param_q, param_k in zip(self.query_encoder.parameters(), self.key_encoder.parameters()):
            param_k.data = param_k.data * momentum + param_q.data * (1.0 - momentum)
    
    @torch.no_grad()
    def _dequeue_and_enqueue(self, keys: torch.Tensor):
        """Update queue with new keys"""
        batch_size = keys.size(0)
        ptr = int(self.queue_ptr)
        
        # Replace keys at ptr
        self.queue[:, ptr:ptr + batch_size] = keys.T
        ptr = (ptr + batch_size) % self.queue_size
        self.queue_ptr[0] = ptr
    
    def forward(self, x_q: torch.Tensor, x_k: torch.Tensor) -> torch.Tensor:
        """Forward pass with contrastive loss"""
        # Query
        q = self.query_encoder(x_q)
        q = F.normalize(q, dim=1)
        
        # Key
        k = self.key_encoder(x_k)
        k = F.normalize(k, dim=1)
        
        # Contrastive loss
        l_pos = torch.einsum('nc,nc->n', q, k).unsqueeze(-1) / self.temperature
        l_neg = torch.einsum('nc,ck->nk', q, self.queue.clone().detach()) / self.temperature
        
        logits = torch.cat([l_pos, l_neg], dim=1)
        labels = torch.zeros(logits.size(0), dtype=torch.long, device=logits.device)
        
        loss = F.cross_entropy(logits, labels)
        
        # Update queue
        self._dequeue_and_enqueue(k)
        
        # Momentum update
        self._momentum_update_key_encoder(self.momentum)
        
        return loss

class MaskedAutoencoder(nn.Module):
    """Masked Autoencoder for Self-Supervised Learning"""
    
    def __init__(self, input_dim: int = 512, hidden_dim: int = 256, mask_ratio: float = 0.25):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.mask_ratio = mask_ratio
        
        # Encoder
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU()
        )
        
        # Decoder
        self.decoder = nn.Sequential(
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, input_dim)
        )
        
        # Mask token
        self.mask_token = nn.Parameter(torch.randn(1, input_dim))
        
        logger.info(f"✅ Masked Autoencoder initialized with mask ratio {mask_ratio}")
    
    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Forward pass with masking"""
        batch_size, seq_len, dim = x.shape
        
        # Create mask
        mask = torch.rand(batch_size, seq_len, device=x.device) < self.mask_ratio
        mask_indices = mask.nonzero()
        unmask_indices = (~mask).nonzero()
        
        # Replace masked tokens with mask token
        x_masked = x.clone()
        x_masked[mask_indices[:, 0], mask_indices[:, 1]] = self.mask_token
        
        # Encode
        encoded = self.encoder(x_masked)
        
        # Decode
        reconstructed = self.decoder(encoded)
        
        # Compute loss only on masked tokens
        loss = F.mse_loss(reconstructed[mask_indices[:, 0], mask_indices[:, 1]], 
                         x[mask_indices[:, 0], mask_indices[:, 1]])
        
        return reconstructed, loss, mask
    
    def reconstruct(self, x: torch.Tensor) -> torch.Tensor:
        """Reconstruct from masked input"""
        mask = torch.zeros_like(x)
        x_masked = x.clone()
        x_masked = self.mask_token * mask + x * (1 - mask)
        
        encoded = self.encoder(x_masked)
        reconstructed = self.decoder(encoded)
        
        return reconstructed

class SSLPreTrainer:
    """Self-Supervised Learning Pre-Trainer"""
    
    def __init__(
        self,
        model: nn.Module,
        learning_rate: float = 1e-4,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.device = device
        self.optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
        
        logger.info(f"✅ SSL Pre-Trainer initialized on {self.device}")
    
    def pretrain_simclr(self, data: torch.Tensor, epochs: int = 50, batch_size: int = 32) -> Dict:
        """Pre-train using SimCLR"""
        losses = []
        
        for epoch in range(epochs):
            epoch_loss = 0
            num_batches = 0
            
            # Create two augmented views
            indices = torch.randperm(data.size(0))
            data_shuffled = data[indices]
            
            for i in range(0, data.size(0), batch_size):
                batch = data_shuffled[i:i+batch_size]
                
                # Two augmented views (simplified: add noise)
                view1 = batch + torch.randn_like(batch) * 0.01
                view2 = batch + torch.randn_like(batch) * 0.01
                
                # Forward pass
                _, z1 = self.model(view1)
                _, z2 = self.model(view2)
                
                # Loss
                loss = self.model.contrastive_loss(z1, z2)
                
                # Backward pass
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.optimizer.step()
                
                epoch_loss += loss.item()
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1] if losses else None,
            'method': 'simclr'
        }
    
    def pretrain_moco(self, data: torch.Tensor, epochs: int = 50, batch_size: int = 32) -> Dict:
        """Pre-train using MoCo"""
        losses = []
        
        for epoch in range(epochs):
            epoch_loss = 0
            num_batches = 0
            
            indices = torch.randperm(data.size(0))
            data_shuffled = data[indices]
            
            for i in range(0, data.size(0), batch_size):
                batch = data_shuffled[i:i+batch_size]
                
                # Query and key views
                view_q = batch + torch.randn_like(batch) * 0.01
                view_k = batch + torch.randn_like(batch) * 0.01
                
                # Forward pass
                loss = self.model(view_q, view_k)
                
                # Backward pass
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.optimizer.step()
                
                epoch_loss += loss.item()
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1] if losses else None,
            'method': 'moco'
        }
    
    def pretrain_mae(self, data: torch.Tensor, epochs: int = 50, batch_size: int = 32) -> Dict:
        """Pre-train using Masked Autoencoder"""
        losses = []
        
        for epoch in range(epochs):
            epoch_loss = 0
            num_batches = 0
            
            indices = torch.randperm(data.size(0))
            data_shuffled = data[indices]
            
            for i in range(0, data.size(0), batch_size):
                batch = data_shuffled[i:i+batch_size]
                
                # Forward pass
                _, loss, _ = self.model(batch)
                
                # Backward pass
                self.optimizer.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
                self.optimizer.step()
                
                epoch_loss += loss.item()
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1] if losses else None,
            'method': 'mae'
        }
    
    def save(self, path: str = "models/ssl_model.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/ssl_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")