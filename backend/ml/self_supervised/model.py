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
        """NT-Xent: exactly one positive among each anchor's non-self candidates."""
        if (z_i.ndim != 2 or z_j.shape != z_i.shape or not z_i.size(0)
                or not z_i.size(1)):
            raise ValueError("paired embeddings require identical nonempty [batch, features] shapes")
        if (not z_i.is_floating_point() or not z_j.is_floating_point()
                or z_i.dtype != z_j.dtype or z_i.device != z_j.device):
            raise ValueError("paired embeddings must share floating dtype and device")
        if not torch.isfinite(z_i).all() or not torch.isfinite(z_j).all():
            raise ValueError("paired embeddings must be finite")
        if (isinstance(self.temperature, bool) or not isinstance(self.temperature, (int, float))
                or not math.isfinite(self.temperature) or self.temperature <= 0):
            raise ValueError("temperature must be a finite positive number")

        batch_size = z_i.size(0)
        z = torch.cat([z_i, z_j], dim=0)
        if z.dtype in (torch.float16, torch.bfloat16):
            z = z.float()
        similarities = torch.matmul(z, z.T) / self.temperature
        if not torch.isfinite(similarities).all():
            raise ValueError("contrastive logits must be representable finitely")
        self_mask = torch.eye(2 * batch_size, device=z.device, dtype=torch.bool)
        logits = similarities.masked_fill(self_mask, float('-inf'))
        positive_indices = (torch.arange(2 * batch_size, device=z.device) + batch_size) % (2 * batch_size)
        return F.cross_entropy(logits, positive_indices)

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
        if isinstance(queue_size, bool) or not isinstance(queue_size, int) or queue_size <= 0:
            raise ValueError("queue_size must be a positive integer")
        if not isinstance(momentum, (int, float)) or not math.isfinite(momentum) or not 0 <= momentum <= 1:
            raise ValueError("momentum must be finite and in [0, 1]")
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
        self._momentum_update_key_encoder(0.0)
        for parameter in self.key_encoder.parameters():
            parameter.requires_grad_(False)
        
        # Queue
        self.register_buffer('queue', torch.randn(projection_dim, queue_size))
        self.queue = F.normalize(self.queue, dim=0)
        self.register_buffer('queue_ptr', torch.zeros(1, dtype=torch.long))
        
        # Temperature
        self.temperature = 0.5
        
        logger.info(f"✅ MoCo initialized with queue size {queue_size}")
    
    @torch.no_grad()
    def _momentum_update_key_encoder(self, momentum: float):
        """Momentum update of key encoder"""
        for param_q, param_k in zip(self.query_encoder.parameters(), self.key_encoder.parameters()):
            param_k.mul_(momentum).add_(param_q, alpha=1.0 - momentum)
    
    @torch.no_grad()
    def _dequeue_and_enqueue(self, keys: torch.Tensor):
        """Admit all rows, retaining only the newest capacity-sized suffix."""
        if (keys.ndim != 2 or keys.shape[1] != self.projection_dim or not len(keys)
                or keys.dtype != self.queue.dtype or keys.device != self.queue.device
                or not torch.isfinite(keys).all()):
            raise ValueError("queue keys require nonempty finite matching [batch, projection] tensors")
        ptr = int(self.queue_ptr.item())
        if not 0 <= ptr < self.queue_size:
            raise ValueError("queue pointer is outside capacity")
        count = len(keys)
        retained = min(count, self.queue_size)
        start = (ptr + count - retained) % self.queue_size
        indices = (torch.arange(retained, device=keys.device) + start) % self.queue_size
        self.queue.index_copy_(1, indices, keys[-retained:].T)
        self.queue_ptr[0] = (ptr + count) % self.queue_size

    def forward(self, x_q: torch.Tensor, x_k: torch.Tensor) -> torch.Tensor:
        """Forward pass with contrastive loss"""
        if (x_q.ndim != 2 or x_q.shape != x_k.shape or not len(x_q)
                or x_q.shape[1] != self.input_dim):
            raise ValueError("MoCo views require identical nonempty [batch, input_dim] shapes")
        parameter = next(self.query_encoder.parameters())
        if (x_q.dtype != parameter.dtype or x_k.dtype != parameter.dtype
                or x_q.device != parameter.device or x_k.device != parameter.device
                or not torch.isfinite(x_q).all() or not torch.isfinite(x_k).all()):
            raise ValueError("MoCo views require finite tensors matching encoder dtype/device")
        if not 0 <= int(self.queue_ptr.item()) < self.queue_size:
            raise ValueError("queue pointer is outside capacity")
        if (not isinstance(self.temperature, (int, float)) or not math.isfinite(self.temperature)
                or self.temperature <= 0):
            raise ValueError("temperature must be finite and positive")
        # Query gradients belong only to the query encoder.
        q = self.query_encoder(x_q)
        q = F.normalize(q, dim=1)
        
        # The momentum dictionary is updated before encoding this training key.
        with torch.no_grad():
            if self.training:
                self._momentum_update_key_encoder(self.momentum)
            k = F.normalize(self.key_encoder(x_k), dim=1)
        
        # Contrastive loss
        l_pos = torch.einsum('nc,nc->n', q, k).unsqueeze(-1) / self.temperature
        l_neg = torch.einsum('nc,ck->nk', q, self.queue.clone().detach()) / self.temperature
        
        logits = torch.cat([l_pos, l_neg], dim=1)
        labels = torch.zeros(logits.size(0), dtype=torch.long, device=logits.device)
        
        loss = F.cross_entropy(logits, labels)
        
        if self.training:
            self._dequeue_and_enqueue(k)
        
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
    
    def _validate_input(self, x: torch.Tensor):
        """Validate the admitted reconstruction dataset without model mutation."""
        if (isinstance(self.mask_ratio, bool) or not isinstance(self.mask_ratio, (int, float))
                or not math.isfinite(self.mask_ratio) or not 0 <= self.mask_ratio <= 1):
            raise ValueError("mask_ratio must be finite and in [0, 1]")
        if x.ndim != 3 or not x.shape[0] or not x.shape[1] or x.shape[2] != self.input_dim:
            raise ValueError("MAE data requires nonempty [batch, tokens, input_dim] shape")
        if (x.dtype != self.mask_token.dtype or x.device != self.mask_token.device
                or not x.is_floating_point() or not torch.isfinite(x).all()):
            raise ValueError("MAE data must be finite floating values matching model dtype/device")

    def forward(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        """Forward pass with masking"""
        self._validate_input(x)
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
        if mask.any():
            predictions, targets = reconstructed[mask], x[mask]
            if predictions.dtype in (torch.float16, torch.bfloat16):
                predictions, targets = predictions.float(), targets.float()
            loss = F.mse_loss(predictions, targets)
        else:
            # Empty observations have a zero objective with a valid zero-gradient graph.
            loss = reconstructed.reshape(-1)[0] * 0
        if not torch.isfinite(loss):
            raise ValueError("masked reconstruction objective must be finite")
        
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
        for name, value in (('epochs', epochs), ('batch_size', batch_size)):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{name} must be a positive integer")
        data = data.to(self.device)
        self.model._validate_input(data)
        losses = []
        observed_batches = 0
        skipped_batches = 0

        for epoch in range(epochs):
            epoch_loss = 0
            num_batches = 0
            
            indices = torch.randperm(data.size(0))
            data_shuffled = data[indices]
            
            for i in range(0, data.size(0), batch_size):
                batch = data_shuffled[i:i+batch_size]
                
                # Forward pass
                _, loss, mask = self.model(batch)
                
                # Backward pass
                self.optimizer.zero_grad()
                if mask.any():
                    observed_batches += 1
                    loss.backward()
                    torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0, error_if_nonfinite=True)
                    self.optimizer.step()
                else:
                    skipped_batches += 1

                epoch_loss += loss.item()
                num_batches += 1
            
            avg_loss = epoch_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1] if losses else None,
            'method': 'mae',
            'observed_batches': observed_batches,
            'skipped_batches': skipped_batches
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