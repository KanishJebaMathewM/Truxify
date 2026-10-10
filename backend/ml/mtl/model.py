import copy
import logging
import os
import tempfile
import threading
from functools import wraps
from typing import Any, Dict, List, Optional

import torch
import torch.nn as nn
import torch.nn.functional as F
from mtl.checkpoint_generation import validate_generation
from torch.utils.data import DataLoader, TensorDataset

logger = logging.getLogger(__name__)

def _owned_generation(method):
    @wraps(method)
    def owned(self, *args, **kwargs):
        with self._generation_lock:
            return method(self, *args, **kwargs)
    return owned


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

    def forward_for_loss(self, x: torch.Tensor) -> torch.Tensor:
        """Raw classification logits; public forward still returns probabilities."""
        return self.head[:-1](x) if self.task_type == 'classification' else self.head(x)

class MultiTaskModel(nn.Module):
    """Multi-Task Learning Model"""
    
    def __init__(
        self,
        input_dim: int,
        tasks: Dict[str, Dict],
        hidden_dim: int = 256
    ):
        super().__init__()
        
        self.tasks = copy.deepcopy(tasks)
        self.shared_encoder = SharedEncoder(input_dim, hidden_dim)
        
        # Task-specific heads
        self.task_heads = nn.ModuleDict()
        for task_name, task_config in self.tasks.items():
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
    
    def forward_for_loss(self, x: torch.Tensor) -> Dict[str, torch.Tensor]:
        """Evaluate shared features once for the native mixed-task objective."""
        shared_features = self.shared_encoder(x)
        return {name: head.forward_for_loss(shared_features)
                for name, head in self.task_heads.items()}

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
        projected = [value.clone() for value in grads]
        for i in range(len(grads)):
            for j in range(len(grads)):
                if i != j:
                    # Compute dot product
                    dot = torch.dot(projected[i].flatten(), grads[j].flatten())
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
        self._generation_lock = threading.RLock()
        self._generation = (model.to(device), None, None)
        self.loss = loss
        self.device = device
        self.task_weights = task_weights or {}
        
        optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer, patience=10, factor=0.5)
        self._generation = (self.model, optimizer, scheduler)
        
        # Gradient surgery methods
        self.gradient_surgery = GradientSurgery()
        self.gradient_method = 'pcgrad'  # pcgrad, grad_drop, mgda
        
        logger.info(f"✅ Multi-Task Trainer initialized on {self.device}")
    
    @property
    def model(self):
        return self._generation[0]

    @property
    def optimizer(self):
        return self._generation[1]

    @property
    def scheduler(self):
        return self._generation[2]

    @_owned_generation
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
        predictions = self.model.forward_for_loss(x)
        
        # Move targets to device
        targets_device = {}
        for task_name, target in targets.items():
            targets_device[task_name] = target.to(self.device)
        
        # Compute losses
        losses = self.loss.compute_losses(predictions, targets_device)
        
        # Compute weighted loss
        total_loss = self.loss.compute_weighted_loss(losses, self.task_weights)
        
        # Backward pass
        if self.gradient_method == 'pcgrad':
            # PCGrad operates on per-task gradients, not the summed gradient.
            # Backpropagate each task loss separately to collect one gradient
            # vector per task, then resolve conflicts across tasks.
            grad_params = [p for p in self.model.parameters() if p.requires_grad]
            if not grad_params or not losses:
                raise ValueError("PCGrad requires trainable parameters and task losses")
            task_vecs = []
            connected = [False] * len(grad_params)
            for task_name, task_loss in losses.items():
                weighted_loss = task_loss * self.task_weights.get(task_name, 1.0)
                task_grads = (torch.autograd.grad(weighted_loss, grad_params,
                                                 retain_graph=True, allow_unused=True)
                              if weighted_loss.requires_grad else [None] * len(grad_params))
                # Every task uses the same full parameter coordinate layout.
                # Unused private heads occupy zero slots, not shifted slots.
                task_vecs.append(torch.cat([
                    (value.detach() if value is not None else torch.zeros_like(param)).flatten()
                    for param, value in zip(grad_params, task_grads)
                ]))
                connected = [old or value is not None for old, value in zip(connected, task_grads)]
            processed = self.gradient_surgery.pcgrad(task_vecs)
            final_grad = torch.stack(processed).sum(0)
            offset = 0
            for param, used in zip(grad_params, connected):
                count = param.numel()
                # Entirely disconnected parameters remain None, so Adam does
                # not advance their moments or apply a stale momentum update.
                param.grad = (final_grad[offset:offset + count].view_as(param).clone()
                              if used else None)
                offset += count
        else:
            total_loss.backward()

        self.optimizer.step()
        
        return {
            'total_loss': total_loss.item(),
            'task_losses': {k: v.item() for k, v in losses.items()}
        }
    
    @_owned_generation
    def _step_scheduler(self, loss):
        self.scheduler.step(loss)

    def _validate_dataset(self, data, targets, *, name):
        """Check the complete named dataset before any training mutation."""
        if not isinstance(data, torch.Tensor) or data.ndim != 2:
            raise ValueError(f"{name} data must be a two-dimensional tensor")
        expected_features = self.model.shared_encoder.encoder[0].in_features
        if data.shape[0] == 0 or data.shape[1] != expected_features:
            raise ValueError(f"{name} data requires nonempty rows and {expected_features} features")
        if not data.is_floating_point() or not torch.isfinite(data).all():
            raise ValueError(f"{name} data must contain finite floating values")
        if data.dtype != next(self.model.parameters()).dtype:
            raise ValueError(f"{name} data dtype must match the model parameters")
        task_names = tuple(self.model.tasks)
        if not task_names or not isinstance(targets, dict) or set(targets) != set(task_names):
            raise ValueError(f"{name} targets must exactly match model tasks {task_names}")
        for task_name in task_names:
            config = self.model.tasks[task_name]
            target = targets[task_name]
            if not isinstance(target, torch.Tensor):
                raise ValueError(f"{name} target {task_name} must be a tensor")
            width = config.get('output_dim', 1)
            if config.get('type', 'regression') == 'classification':
                if target.shape != (len(data),) or target.dtype != torch.long:
                    raise ValueError(f"{name} target {task_name} requires one int64 class index per row")
                if ((target < 0) | (target >= width)).any():
                    raise ValueError(f"{name} target {task_name} class indices must be in [0, {width})")
            elif (target.shape != (len(data), width) or not target.is_floating_point()
                  or target.dtype != data.dtype):
                raise ValueError(f"{name} target {task_name} requires floating shape ({len(data)}, {width}) and data dtype")
            if not torch.isfinite(target).all():
                raise ValueError(f"{name} target {task_name} must contain finite values")
        return task_names

    @_owned_generation
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
        
        # Admission is complete before any batch changes model or optimizer state.
        for label, value in (('epochs', epochs), ('batch_size', batch_size)):
            if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
                raise ValueError(f"{label} must be a positive integer")
        task_names = self._validate_dataset(train_data, train_targets, name='training')
        if (val_data is None) != (val_targets is None):
            raise ValueError("validation data and targets must be supplied together")
        if val_data is not None:
            self._validate_dataset(val_data, val_targets, name='validation')

        # Use the same names for dataset serialization and batch reconstruction.
        dataset = TensorDataset(train_data, *[train_targets[t] for t in task_names])
        dataloader = DataLoader(dataset, batch_size=batch_size, shuffle=True)
        
        for epoch in range(epochs):
            epoch_loss = 0
            epoch_task_losses = {}
            
            for batch in dataloader:
                x = batch[0]
                targets = {}
                for i, task_name in enumerate(task_names):
                    targets[task_name] = batch[i + 1]
                
                step_result = self.train_step(x, targets)
                epoch_loss += step_result['total_loss']
                
                for task_name, loss in step_result['task_losses'].items():
                    epoch_task_losses[task_name] = epoch_task_losses.get(task_name, 0) + loss
            
            avg_loss = epoch_loss / len(dataloader)
            losses.append(avg_loss)
            
            # Update scheduler
            self._step_scheduler(avg_loss)
            
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
    
    @_owned_generation
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
            predictions = self.model.forward_for_loss(val_data)
            
            targets_device = {}
            for task_name, target in val_targets.items():
                targets_device[task_name] = target.to(self.device)
            
            losses = self.loss.compute_losses(predictions, targets_device)
            total_loss = self.loss.compute_weighted_loss(losses, self.task_weights)
        
        return total_loss.item()
    
    @_owned_generation
    def predict(self, x: torch.Tensor, task_name=None) -> Dict[str, torch.Tensor]:
        """Own one serving generation and restore every native module mode."""
        model = self.model
        if task_name is not None and task_name not in model.task_heads:
            raise ValueError("Unknown MTL task")
        modes = [(module, module.training) for module in model.modules()]
        model.eval()
        try:
            with torch.no_grad():
                x = x.to(self.device)
                return model(x) if task_name is None else model.forward_single_task(x, task_name)
        finally:
            for module, training in modes:
                module.training = training

    def save(self, path: str = "models/mtl_model.pth"):
        """Capture one owned generation, then atomically replace the file."""
        with self._generation_lock:
            model, optimizer, scheduler = self._generation
            snapshot = copy.deepcopy({'model_state_dict':model.state_dict(),
                'optimizer_state_dict':optimizer.state_dict(), 'task_config':model.tasks,
                'scheduler_state_dict':scheduler.state_dict()})
            self._candidate_generation(snapshot)
        destination = os.path.abspath(os.fspath(path))
        fd, temporary = tempfile.mkstemp(prefix='.mtl-',suffix='.tmp',dir=os.path.dirname(destination))
        try:
            with os.fdopen(fd,'wb') as output:
                torch.save(snapshot,output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary,destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)

    def _candidate_generation(self, checkpoint):
        model = copy.deepcopy(self.model)
        model.zero_grad(set_to_none=True)
        optimizer = torch.optim.Adam(model.parameters(),lr=self.optimizer.param_groups[0]['lr'])
        scheduler = torch.optim.lr_scheduler.ReduceLROnPlateau(optimizer,patience=10,factor=0.5)
        validate_generation(model,optimizer,scheduler,checkpoint)
        return model,optimizer,scheduler

    def load(self, path: str = "models/mtl_model.pth"):
        """Validate a private model/Adam/scheduler and publish one native pair."""
        checkpoint = torch.load(path,map_location=self.device,weights_only=True)
        with self._generation_lock:
            self._generation = self._candidate_generation(checkpoint)
