import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
import numpy as np
from typing import Dict, List, Optional, Tuple
import logging
from tqdm import tqdm
from datetime import datetime

logger = logging.getLogger(__name__)

class DiffusionTrainer:
    """Trainer for diffusion models"""
    
    def __init__(
        self,
        model: nn.Module,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        lr: float = 1e-4,
        batch_size: int = 32
    ):
        self.model = model.to(device)
        self.device = device
        self.batch_size = batch_size
        
        # Optimizer
        self.optimizer = optim.AdamW(model.parameters(), lr=lr)
        
        # Metrics
        self.train_losses = []
        self.val_losses = []
        
        logger.info(f"✅ Trainer initialized on {device}")
    
    def train_step(
        self,
        x: torch.Tensor,
        condition: Optional[torch.Tensor] = None
    ) -> float:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Move to device
        x = x.to(self.device)
        if condition is not None:
            condition = condition.to(self.device)
        
        # Sample random timesteps
        t = torch.randint(0, self.model.num_timesteps, (x.shape[0],), device=self.device)
        
        # Add noise
        noise = torch.randn_like(x)
        x_noisy = self.model.add_noise(x, t, noise)
        
        # Combine with condition
        if condition is not None:
            x_noisy = torch.cat([x_noisy, condition], dim=-1)
        
        # Predict noise
        predicted_noise = self.model.denoise(x_noisy, t)
        
        # Loss
        loss = nn.MSELoss()(predicted_noise, noise)
        
        # Backward
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.optimizer.step()
        
        return loss.item()
    
    def train_epoch(
        self,
        dataloader: DataLoader,
        condition_loader: Optional[DataLoader] = None
    ) -> float:
        """Train one epoch"""
        epoch_loss = 0.0
        num_batches = 0
        
        condition_iter = iter(condition_loader) if condition_loader is not None else None

        for batch_idx, x in enumerate(tqdm(dataloader, desc="Training")):
            condition = None
            if condition_iter is not None:
                try:
                    condition = next(condition_iter)[0]
                except StopIteration:
                    condition_iter = iter(condition_loader)
                    condition = next(condition_iter)[0]
            
            loss = self.train_step(x, condition)
            epoch_loss += loss
            num_batches += 1
        
        return epoch_loss / num_batches
    
    def train(
        self,
        train_data: torch.Tensor,
        epochs: int = 100,
        val_data: Optional[torch.Tensor] = None,
        condition_data: Optional[torch.Tensor] = None
    ) -> Dict:
        """Full training loop"""
        # Create dataloaders
        train_dataset = TensorDataset(train_data)
        train_loader = DataLoader(train_dataset, batch_size=self.batch_size, shuffle=True)
        
        if val_data is not None:
            val_dataset = TensorDataset(val_data)
            val_loader = DataLoader(val_dataset, batch_size=self.batch_size, shuffle=False)
        
        if condition_data is not None:
            condition_dataset = TensorDataset(condition_data)
            condition_loader = DataLoader(condition_dataset, batch_size=self.batch_size, shuffle=True)
        else:
            condition_loader = None
        
        # Training loop
        for epoch in range(epochs):
            # Train
            train_loss = self.train_epoch(train_loader, condition_loader)
            self.train_losses.append(train_loss)
            
            # Validate
            if val_data is not None:
                val_loss = self.validate(val_loader)
                self.val_losses.append(val_loss)
            
            # Log
            if (epoch + 1) % 10 == 0:
                logger.info(
                    f"Epoch {epoch + 1}/{epochs} - "
                    f"Train Loss: {train_loss:.4f}, "
                    f"Val Loss: {val_loss:.4f}" if val_data is not None else f"Train Loss: {train_loss:.4f}"
                )
        
        return {
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'final_train_loss': self.train_losses[-1] if self.train_losses else None,
            'final_val_loss': self.val_losses[-1] if self.val_losses else None
        }
    
    def validate(self, dataloader: DataLoader) -> float:
        """Validate model"""
        self.model.eval()
        val_loss = 0.0
        num_batches = 0
        
        with torch.no_grad():
            for x in tqdm(dataloader, desc="Validating"):
                x = x[0].to(self.device)
                
                # Sample timesteps
                t = torch.randint(0, self.model.num_timesteps, (x.shape[0],), device=self.device)
                
                # Add noise
                noise = torch.randn_like(x)
                x_noisy = self.model.add_noise(x, t, noise)
                
                # Predict noise
                predicted_noise = self.model.denoise(x_noisy, t)
                
                # Loss
                loss = nn.MSELoss()(predicted_noise, noise)
                val_loss += loss.item()
                num_batches += 1
        
        return val_loss / num_batches
    
    def generate_routes(self, num_routes: int = 10, route_length: int = 50) -> torch.Tensor:
        """Generate routes using trained model"""
        self.model.eval()
        with torch.no_grad():
            routes = self.model.sample(num_routes, route_length)
        return routes
    
    def save_checkpoint(self, path: str = "models/diffusion_checkpoint.pth"):
        """Save training checkpoint"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'train_losses': self.train_losses,
            'val_losses': self.val_losses,
            'timestamp': datetime.now().isoformat()
        }, path)
        logger.info(f"✅ Checkpoint saved to {path}")
    
    def load_checkpoint(self, path: str = "models/diffusion_checkpoint.pth"):
        """Load training checkpoint"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        self.train_losses = checkpoint['train_losses']
        self.val_losses = checkpoint['val_losses']
        logger.info(f"✅ Checkpoint loaded from {path}")