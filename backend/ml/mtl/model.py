import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
import logging
from torch.utils.data import DataLoader, TensorDataset

logger = logging.getLogger(__name__)

class SharedEncoder(nn.Module):
    """Shared encoder for multi-task learning"""
    
    def __init__(self, input_dim: int, hidden_dim: int = 256):
        super().__init__()
        
        self.encoder = nn.Sequential(
            nn.Linear(input_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU()
        )
        
        logger.info(f"✅ Shared Encoder initialized with input_dim={input_dim}, hidden_dim={hidden_dim}")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.encoder(x)

class TaskSpecificHead(nn.Module):
    """Task-specific head for multi-task learning"""
    
    def __init__(self, input_dim: int, output_dim: int, task_type: str = 'regression'):
        super().__init__()
        
        self.task_type = task_type
        
        self.head = nn.Sequential(
            nn.Linear(input_dim, 128),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(128, 64),
            nn.ReLU(),
            nn.Linear(64, output_dim)
        )
        
        if task_type == 'classification':
            self.head.add_module('softmax', nn.Softmax(dim=-1))
        
        logger.info(f"✅ Task Head initialized: {task_type} (output_dim={output_dim})")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.head(x)

class MultiTaskModel(nn.Module):
    """Multi-Task Learning Model"""
    
    def __init__(
        self,
        input_dim: int,
        tasks: Dict[str, Dict],
        hidden_dim: int = 256
    ):
        super().__init__()
        
        self.tasks = tasks
        self.shared_encoder = SharedEncoder(input_dim, hidden_dim)
        
        # Task-specific heads
        self.task_heads = nn.ModuleDict()
        for task_name, task_config in tasks.items():
            output_dim = task_config.get('output_dim', 1)
            task_type = task_config.get('type', 'regression')
            self.task_heads[task_name] = TaskSpecificHead(
                hidden_dim, output_dim, task_type
            )
        
        logger.info(f"✅ Multi-Task Model initialized with {len(tasks)} tasks")
    
    def forward(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        shared_features = self.shared_encoder(x)
        
        outputs = {}
        for task_name, head in self.task_heads.items():
            outputs[task_name] = head(shared_features)
        
        return outputs
    
    def forward_single_task(self, x: torch.Tensor, task_name: str) -> torch.Tensor:
        shared_features = self.shared_encoder(x)
        return self.task_heads[task_name](shared_features)

class TaskWeighting:
    """Dynamic task weighting strategies"""
    
    @staticmethod
    def uniform(num_tasks: int) -> torch.Tensor:
        """Uniform weighting"""
        return torch.ones(num_tasks) / num_tasks
    
    @staticmethod
    def uncertainty_weighting(losses: torch.Tensor, log_vars: torch.Tensor) -> torch.Tensor:
        """Uncertainty-based weighting"""
        return 1 / (2 * torch.exp(log_vars))
    
    @staticmethod
    def dynamic_weight_average(
        losses: torch.Tensor,
        prev_losses: Optional[torch.Tensor] = None,
        temperature: float = 2.0
    ) -> torch.Tensor:
        """Dynamic weight averaging"""
        if prev_losses is None:
            return torch.ones_like(losses) / len(losses)
        
        # Normalize losses
        norm_losses = losses / prev_losses
        weights = F.softmax(norm_losses / temperature, dim=0)
        return weights

class GradientSurgery:
    """Gradient surgery for multi-task learning"""
    
    @staticmethod
    def pcgrad(grads: List[torch.Tensor]) -> List[torch.Tensor]:
        """Project Conflicting Gradients"""
        if len(grads) <= 1:
            return grads
        
        # For each gradient, project to remove conflicts
        projected = grads.copy()
        for i in range(len(grads)):
            for j in range(len(grads)):
                if i != j:
                    # Compute dot product
                    dot = torch.dot(grads[i].flatten(), grads[j].flatten())
                    if dot < 0:  # Conflicting gradients
                        # Project gradient
                        norm_sq = torch.norm(grads[j]) ** 2
                        if norm_sq > 0:
                            projection = (dot / norm_sq) * grads[j]
                            projected[i] = projected[i] - projection
        
        return projected
    
    @staticmethod
    def grad_drop(grads: List[torch.Tensor], threshold: float = 0.01) -> List[torch.Tensor]:
        """Drop gradients below threshold"""
        filtered = []
        for grad in grads:
            norm = torch.norm(grad)
            if norm > threshold:
                filtered.append(grad)
            else:
                filtered.append(torch.zeros_like(grad))
        return filtered
    
    @staticmethod
    def mgda(grads: List[torch.Tensor]) -> List[torch.Tensor]:
        """Multiple Gradient Descent Algorithm"""
        # Simplified: take weighted combination
        weights = torch.ones(len(grads)) / len(grads)
        combined = torch.zeros_like(grads[0])
        for grad, weight in zip(grads, weights):
            combined += weight * grad
        return [combined] * len(grads)

class MTLLoss:
    """Multi-task loss computation"""
    
    def __init__(self, task_losses: Dict[str, nn.Module]):
        self.task_losses = task_losses
        
        logger.info(f"✅ MTL Loss initialized with {len(task_losses)} tasks")
    
    def compute_losses(
        self,
        predictions: Dict[str, torch.Tensor],
        targets: Dict[str, torch.Tensor]
    ) -> Dict[str, torch.Tensor]:
        """Compute losses for all tasks"""
        losses = {}
        for task_name, pred in predictions.items():
            if task_name in self.task_losses:
                losses[task_name] = self.task_losses[task_name](pred, targets[task_name])
        
        return losses
    
    def compute_weighted_loss(
        self,
        losses: Dict[str, torch.Tensor],
        weights: Dict[str, float]
    ) -> torch.Tensor:
        """Compute weighted sum of losses"""
        total_loss = 0
        for task_name, loss in losses.items():
            weight = weights.get(task_name, 1.0)
            total_loss += weight * loss
        
        return total_loss

class MultiTaskTrainer:
    """Trainer for multi-task learning"""
    
    def __init__(
        self,
        model: MultiTaskModel,
        loss: MTLLoss,
        lr: float = 1e-3,
        device: str = "cuda" if torch.cuda.is_available() else "cpu",
        task_weights: Optional[Dict[str, float]] = None
    ):
        self.model = model.to(device)
        self.loss = loss
        self.device = device
        self.task_weights = task_weights or {}
        
        self.optimizer = torch.optim.Adam(model.parameters(), lr=lr)
        self.scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(
            self.optimizer, patience=10, factor=0.5
        )
        
        # Gradient surgery methods
        self.gradient_surgery = GradientSurgery()
        self.gradient_method = 'pcgrad'  # pcgrad, grad_drop, mgda
        
        logger.info(f"✅ Multi-Task Trainer initialized on {self.device}")
    
    def train_step(
        self,
        x: torch.Tensor,
        targets: Dict[str, torch.Tensor]
    ) -> Dict[str, Any]:
        """Single training step"""
        self.model.train()
        self.optimizer.zero_grad()
        
        # Forward pass
        x = x.to(self.device)
        predictions = self.model(x)
        
        # Move targets to device
        targets_device = {}
        for task_name, target in targets.items():
            targets_device[task_name] = target.to(self.device)
        
        # Compute losses
        losses = self.loss.compute_losses(predictions, targets_device)
        
        # Compute weighted loss
        total_loss = self.loss.compute_weighted_loss(losses, self.task_weights)
        
        # Backward pass
        total_loss.backward()
        
        # Gradient surgery
        if self.gradient_method == 'pcgrad':
            grads = [p.grad for p in self.model.parameters() if p.grad is not None]
            processed_grads = self.gradient_surgery.pcgrad(grads)
            for p, g in zip([p for p in self.model.parameters() if p.grad is not None], processed_grads):
                p.grad = g
        
        self.optimizer.step()
        
        return {
            'total_loss': total_loss.item(),
            'task_losses': {k: v.item() for k, v in losses.items()}
        }
    
    def train(
        self,
        train_data: torch.Tensor,
        train_targets: Dict[str, torch.Tensor],
        epochs: int = 50,
        batch_size: int = 32,
        val_data: Optional[torch.Tensor] = None,
        val_targets: Optional[Dict[str, torch.Tensor]] = None
    ) -> Dict:
        """Full training loop"""
        losses = []
        val_losses = []
        
        # Create dataloader
        dataset = TensorDataset(train_data, *[train_targets[t] for t in train_targets.keys()])
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
        
        for epoch in range(epochs):
            epoch_loss = 0
            epoch_task_losses = {}
            
            for batch in dataloader:
                x = batch[0]
                targets = {}
                for i, task_name in enumerate(self.model.tasks.keys()):
                    targets[task_name] = batch[i + 1]
                
                step_result = self.train_step(x, targets)
                epoch_loss += step_result['total_loss']
                
                for task_name, loss in step_result['task_losses'].items():
                    epoch_task_losses[task_name] = epoch_task_losses.get(task_name, 0) + loss
            
            avg_loss = epoch_loss / len(dataloader)
            losses.append(avg_loss)
            
            # Update scheduler
            self.scheduler.step(avg_loss)
            
            # Validation
            if val_data is not None and val_targets is not None:
                val_loss = self.validate(val_data, val_targets)
                val_losses.append(val_loss)
                logger.info(
                    f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}, Val Loss={val_loss:.4f}"
                )
            else:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'train_losses': losses,
            'val_losses': val_losses,
            'final_loss': losses[-1],
            'final_val_loss': val_losses[-1] if val_losses else None
        }
    
    def validate(
        self,
        val_data: torch.Tensor,
        val_targets: Dict[str, torch.Tensor]
    ) -> float:
        """Validate model"""
        self.model.eval()
        total_loss = 0
        
        with torch.no_grad():
            val_data = val_data.to(self.device)
            predictions = self.model(val_data)
            
            targets_device = {}
            for task_name, target in val_targets.items():
                targets_device[task_name] = target.to(self.device)
            
            losses = self.loss.compute_losses(predictions, targets_device)
            total_loss = self.loss.compute_weighted_loss(losses, self.task_weights)
        
        return total_loss.item()
    
    def predict(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Make predictions"""
        self.model.eval()
        with torch.no_grad():
            x = x.to(self.device)
            return self.model(x)
    
    def save(self, path: str = "models/mtl_model.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.optimizer.state_dict(),
            'task_config': self.model.tasks
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/mtl_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")