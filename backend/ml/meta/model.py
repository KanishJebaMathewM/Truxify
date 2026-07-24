import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
from collections import OrderedDict
import logging
import copy

logger = logging.getLogger(__name__)

class MAMLModel(nn.Module):
    """Model-Agnostic Meta-Learning (MAML)"""
    
    def __init__(
        self,
        input_dim: int = 64,
        hidden_dim: int = 256,
        output_dim: int = 1,
        num_layers: int = 3
    ):
        super().__init__()
        
        self.input_dim = input_dim
        self.hidden_dim = hidden_dim
        self.output_dim = output_dim
        self.num_layers = num_layers
        
        # Build network
        layers = []
        layers.append(nn.Linear(input_dim, hidden_dim))
        layers.append(nn.ReLU())
        layers.append(nn.Dropout(0.2))
        
        for _ in range(num_layers - 1):
            layers.append(nn.Linear(hidden_dim, hidden_dim))
            layers.append(nn.ReLU())
            layers.append(nn.Dropout(0.2))
        
        layers.append(nn.Linear(hidden_dim, output_dim))
        
        self.network = nn.Sequential(*layers)
        
        logger.info(f"✅ MAML initialized: input_dim={input_dim}, hidden_dim={hidden_dim}")
    
    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.network(x)
    
    def clone(self) -> 'MAMLModel':
        """Create a clone of the model"""
        clone = MAMLModel(
            self.input_dim,
            self.hidden_dim,
            self.output_dim,
            self.num_layers
        )
        clone.load_state_dict(self.state_dict())
        return clone
    
    def update(self, grad, lr: float = 0.01):
        """Update model parameters with gradient"""
        for param, g in zip(self.parameters(), grad):
            param.data -= lr * g

class MAML:
    """Model-Agnostic Meta-Learning Algorithm"""
    
    def __init__(
        self,
        model: MAMLModel,
        inner_lr: float = 0.01,
        outer_lr: float = 0.001,
        device: str = "cuda" if torch.cuda.is_available() else "cpu"
    ):
        self.model = model.to(device)
        self.inner_lr = inner_lr
        self.outer_lr = outer_lr
        self.device = device
        
        self.outer_optimizer = torch.optim.Adam(self.model.parameters(), lr=outer_lr)
        self.criterion = nn.MSELoss()
        
        logger.info(f"✅ MAML initialized on {self.device}")
    
    def inner_update(self, model: MAMLModel, support_x: torch.Tensor, support_y: torch.Tensor) -> MAMLModel:
        """Perform inner loop update (task-specific adaptation)"""
        # Clone model for inner update
        adapted_model = model.clone()
        
        # Compute gradients on support set
        pred = adapted_model(support_x)
        loss = self.criterion(pred, support_y)
        
        # Compute gradients
        grads = torch.autograd.grad(loss, adapted_model.parameters(), create_graph=True)
        
        # Update parameters
        for param, grad in zip(adapted_model.parameters(), grads):
            param.data -= self.inner_lr * grad
        
        return adapted_model
    
    def outer_update(self, meta_loss: torch.Tensor):
        """Perform outer loop update (meta-optimization)"""
        self.outer_optimizer.zero_grad()
        meta_loss.backward()
        torch.nn.utils.clip_grad_norm_(self.model.parameters(), 1.0)
        self.outer_optimizer.step()
    
    def meta_train_step(
        self,
        tasks: List[Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]],
        k_shot: int = 5
    ) -> float:
        """Single meta-training step"""
        meta_loss = 0.0
        
        for support_x, support_y, query_x, query_y in tasks:
            # Inner adaptation on support set
            adapted_model = self.inner_update(self.model, support_x, support_y)
            
            # Compute loss on query set
            pred = adapted_model(query_x)
            task_loss = self.criterion(pred, query_y)
            meta_loss += task_loss
        
        # Average loss across tasks
        meta_loss = meta_loss / len(tasks)
        
        # Outer update
        self.outer_update(meta_loss)
        
        return meta_loss.item()
    
    def meta_train(
        self,
        task_generator,
        num_epochs: int = 100,
        tasks_per_epoch: int = 10,
        k_shot: int = 5
    ) -> Dict:
        """Full meta-training loop"""
        losses = []
        
        for epoch in range(num_epochs):
            # Sample tasks
            tasks = task_generator.sample_tasks(tasks_per_epoch, k_shot)
            
            # Meta-train step
            loss = self.meta_train_step(tasks, k_shot)
            losses.append(loss)
            
            if (epoch + 1) % 10 == 0:
                logger.info(f"Epoch {epoch+1}/{num_epochs}: Meta Loss={loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1]
        }
    
    def adapt(self, support_x: torch.Tensor, support_y: torch.Tensor, steps: int = 5) -> MAMLModel:
        """Adapt model to new task"""
        adapted_model = self.model.clone()
        
        for _ in range(steps):
            pred = adapted_model(support_x)
            loss = self.criterion(pred, support_y)
            
            grads = torch.autograd.grad(loss, adapted_model.parameters(), create_graph=True)
            
            for param, grad in zip(adapted_model.parameters(), grads):
                param.data -= self.inner_lr * grad
        
        return adapted_model
    
    def predict(self, model: MAMLModel, x: torch.Tensor) -> torch.Tensor:
        """Make prediction with adapted model"""
        model.eval()
        with torch.no_grad():
            return model(x)
    
    def save(self, path: str = "models/maml_model.pth"):
        """Save model"""
        torch.save({
            'model_state_dict': self.model.state_dict(),
            'optimizer_state_dict': self.outer_optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/maml_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location=self.device)
        self.model.load_state_dict(checkpoint['model_state_dict'])
        self.outer_optimizer.load_state_dict(checkpoint['optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")

class FewShotLearner:
    """Few-Shot Learning for Logistics Tasks"""
    
    def __init__(self, maml: MAML):
        self.maml = maml
        self.adaptation_steps = 5
        
        logger.info("✅ Few-Shot Learner initialized")
    
    def few_shot_predict(
        self,
        support_x: np.ndarray,
        support_y: np.ndarray,
        query_x: np.ndarray,
        steps: int = 5
    ) -> np.ndarray:
        """Few-shot prediction"""
        # Convert to tensors
        support_x_t = torch.tensor(support_x, dtype=torch.float32)
        support_y_t = torch.tensor(support_y, dtype=torch.float32)
        query_x_t = torch.tensor(query_x, dtype=torch.float32)
        
        # Adapt to task
        adapted_model = self.maml.adapt(support_x_t, support_y_t, steps)
        
        # Predict
        predictions = self.maml.predict(adapted_model, query_x_t)
        
        return predictions.cpu().numpy()
    
    def few_shot_classify(
        self,
        support_set: Dict[str, np.ndarray],
        query_x: np.ndarray,
        steps: int = 5
    ) -> np.ndarray:
        """Few-shot classification"""
        # Prepare support data
        support_x = []
        support_y = []
        
        for label, data in support_set.items():
            support_x.append(data)
            support_y.append([int(label)] * len(data))
        
        support_x = np.concatenate(support_x, axis=0)
        support_y = np.concatenate(support_y, axis=0)
        
        # Convert to tensors
        support_x_t = torch.tensor(support_x, dtype=torch.float32)
        support_y_t = torch.tensor(support_y, dtype=torch.long)
        query_x_t = torch.tensor(query_x, dtype=torch.float32)
        
        # Adapt
        adapted_model = self.maml.adapt(support_x_t, support_y_t.float().unsqueeze(1), steps)
        
        # Predict
        predictions = self.maml.predict(adapted_model, query_x_t)
        classes = torch.round(predictions).squeeze().int()
        
        return classes.cpu().numpy()

class TaskGenerator:
    """Task generator for meta-learning"""
    
    def __init__(self, num_tasks: int = 1000, input_dim: int = 64):
        self.num_tasks = num_tasks
        self.input_dim = input_dim
        self.tasks = []
        
        self._generate_tasks()
        
        logger.info(f"✅ Task Generator initialized with {num_tasks} tasks")
    
    def _generate_tasks(self):
        """Generate synthetic tasks"""
        for i in range(self.num_tasks):
            # Random linear function
            w = np.random.randn(self.input_dim, 1)
            b = np.random.randn(1)
            
            self.tasks.append({
                'weights': w,
                'bias': b,
                'task_id': i
            })
    
    def sample_task(self, k_shot: int = 5) -> Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
        """Sample a single task"""
        task = np.random.choice(self.tasks)
        w = task['weights']
        b = task['bias']
        
        # Generate support set
        support_x = np.random.randn(k_shot, self.input_dim)
        support_y = support_x @ w + b + np.random.randn(k_shot, 1) * 0.1
        
        # Generate query set
        query_x = np.random.randn(10, self.input_dim)
        query_y = query_x @ w + b + np.random.randn(10, 1) * 0.1
        
        return (
            torch.tensor(support_x, dtype=torch.float32),
            torch.tensor(support_y, dtype=torch.float32),
            torch.tensor(query_x, dtype=torch.float32),
            torch.tensor(query_y, dtype=torch.float32)
        )
    
    def sample_tasks(self, num_tasks: int, k_shot: int = 5) -> List[Tuple]:
        """Sample multiple tasks"""
        tasks = []
        for _ in range(num_tasks):
            tasks.append(self.sample_task(k_shot))
        return tasks
    
    def generate_few_shot_task(self, k_shot: int = 5, num_classes: int = 2) -> Dict:
        """Generate few-shot classification task"""
        task = np.random.choice(self.tasks)
        w = task['weights']
        b = task['bias']
        
        # Generate support set for each class
        support_set = {}
        for cls in range(num_classes):
            x = np.random.randn(k_shot, self.input_dim)
            y = (x @ w + b > 0).astype(int)
            support_set[str(cls)] = x
        
        # Generate query set
        query_x = np.random.randn(10, self.input_dim)
        query_y = (query_x @ w + b > 0).astype(int)
        
        return {
            'support_set': support_set,
            'query_x': query_x,
            'query_y': query_y
        }