import copy
import logging
import math
import os
import tempfile
import threading
from functools import wraps
from typing import Dict, List, Optional, Tuple

import numpy as np
import torch
import torch.nn as nn
from meta.training_admission import (
    MetaTrainingTransitionError,
    admit_tasks,
    checked_outer_step,
    finite_tensor,
    positive_count,
)


def _generation_operation(method):
    @wraps(method)
    def owned(self, *args, **kwargs):
        with self._generation_lock:
            return method(self, *args, **kwargs)
    return owned

logger = logging.getLogger(__name__)

try:
    from torch.func import functional_call as _functional_call
except AttributeError:  # older torch
    from torch.nn.utils.stateless import functional_call as _functional_call


class _AdaptedModel:
    """Thin wrapper holding graph-tracking adapted parameters.

    Forwarding goes through ``functional_call`` so the computation graph
    stays connected back to the original (meta) model parameters, allowing
    second-order gradients to flow into ``self.model`` during meta-updates.
    """

    def __init__(self, base_model: nn.Module, params: Dict[str, torch.Tensor], *, copy_model=True):
        # Functional parameters retain their original autograd links. Module
        # modes/buffers belong to this task, not to the shared meta model.
        self.base_model = copy.deepcopy(base_model) if copy_model else base_model
        self.params = params

    def __call__(self, x: torch.Tensor) -> torch.Tensor:
        return _functional_call(self.base_model, self.params, (x,))

    @property
    def training(self):
        return self.base_model.training

    def eval(self) -> "_AdaptedModel":
        return self.train(False)

    def train(self, mode: bool = True) -> "_AdaptedModel":
        self.base_model.train(mode)
        return self


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
        self._generation_lock = threading.RLock()
        self._generation = (model.to(device), None)
        self.inner_lr = inner_lr
        self.outer_lr = outer_lr
        self.device = device
        
        self._generation = (self.model, torch.optim.Adam(self.model.parameters(), lr=outer_lr))
        self.criterion = nn.MSELoss()
        
        logger.info(f"✅ MAML initialized on {self.device}")
    
    @property
    def model(self):
        return self._generation[0]

    @property
    def outer_optimizer(self):
        return self._generation[1]

    @staticmethod
    def _paired_targets(predictions, targets):
        """Scalar labels refer to rows, never a broadcast loss matrix."""
        if targets.dim() == 1 and predictions.dim() == 2 and predictions.size(1) == 1:
            targets = targets.unsqueeze(1)
        if targets.shape != predictions.shape:
            raise ValueError("Support/query targets must match prediction rows and outputs")
        return targets

    def inner_update(self, model: MAMLModel, support_x: torch.Tensor, support_y: torch.Tensor) -> _AdaptedModel:
        """Perform inner loop update (task-specific adaptation).

        Uses differentiable (graph-preserving) parameter updates so that the
        query loss computed through the adapted parameters back-propagates
        through the inner step into ``self.model`` parameters.
        """
        adapted = {name: p.clone() for name, p in model.named_parameters()}

        pred = _functional_call(model, adapted, (support_x,))
        loss = self.criterion(pred, self._paired_targets(pred, support_y))
        finite_tensor(loss, "support objective")

        grads = torch.autograd.grad(loss, list(adapted.values()), create_graph=True)

        adapted = {
            name: param - self.inner_lr * grad
            for (name, param), grad in zip(adapted.items(), grads)
        }

        return _AdaptedModel(model, adapted)
    
    @_generation_operation
    def outer_update(self, meta_loss: torch.Tensor):
        """Perform outer loop update (meta-optimization)"""
        checked_outer_step(self.model, self.outer_optimizer, meta_loss)
    
    @_generation_operation
    def meta_train_step(
        self,
        tasks: List[Tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]],
        k_shot: int = 5
    ) -> float:
        """Single meta-training step"""
        positive_count(k_shot, "k_shot", 4096)
        tasks = admit_tasks(tasks, self.model)
        if not math.isfinite(self.inner_lr) or self.inner_lr < 0:
            raise MetaTrainingTransitionError("inner learning rate must be finite and nonnegative")
        meta_loss = 0.0

        for support_x, support_y, query_x, query_y in tasks:
            # Inner adaptation on support set
            adapted_model = self.inner_update(self.model, support_x, support_y)

            for parameter in adapted_model.params.values():
                finite_tensor(parameter, "adapted parameter")
            # Compute loss on query set (graph flows back into self.model)
            pred = finite_tensor(adapted_model(query_x), "query predictions")
            task_loss = self.criterion(pred, self._paired_targets(pred, query_y))
            finite_tensor(task_loss, "query objective")
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
        """Full meta-training loop; each batch is an independently checked transition."""
        positive_count(num_epochs, "num_epochs", 10000)
        positive_count(tasks_per_epoch, "tasks_per_epoch", 256)
        positive_count(k_shot, "k_shot", 4096)
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
    
    @_generation_operation
    def adapt(self, support_x: torch.Tensor, support_y: torch.Tensor, steps: int = 5,
              *, training: Optional[bool] = None) -> _AdaptedModel:
        """Adapt with private module modes and graph-preserving parameters."""
        working_model = copy.deepcopy(self.model)
        if training is not None:
            working_model.train(training)
        adapted = {name: p.clone() for name, p in self.model.named_parameters()}

        for _ in range(steps):
            pred = _functional_call(working_model, adapted, (support_x,))
            loss = self.criterion(pred, self._paired_targets(pred, support_y))

            grads = torch.autograd.grad(loss, list(adapted.values()), create_graph=True)

            adapted = {
                name: param - self.inner_lr * grad
                for (name, param), grad in zip(adapted.items(), grads)
            }

        return _AdaptedModel(working_model, adapted, copy_model=False)
    
    @_generation_operation
    def predict(self, model: MAMLModel, x: torch.Tensor) -> torch.Tensor:
        """Make prediction with adapted model"""
        was_training = model.training
        model.eval()
        try:
            with torch.no_grad():
                return model(x)
        finally:
            model.train(was_training)
    
    def save(self, path: str = "models/maml_model.pth"):
        """Capture one owned pair; preserve the destination on failed serialization."""
        with self._generation_lock:
            model, optimizer = self._generation
            snapshot = copy.deepcopy({
                'model_state_dict': model.state_dict(),
                'optimizer_state_dict': optimizer.state_dict(),
            })
        destination = os.path.abspath(os.fspath(path))
        fd, temporary = tempfile.mkstemp(prefix=".maml-", suffix=".tmp",
                                         dir=os.path.dirname(destination))
        try:
            with os.fdopen(fd, "wb") as output:
                torch.save(snapshot, output)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, destination)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        logger.info("MAML model saved to %s", path)

    @staticmethod
    def _validate_checkpoint_pair(model, optimizer, checkpoint):
        if not isinstance(checkpoint, dict):
            raise ValueError("MAML checkpoint must contain a model/Adam pair")
        state = checkpoint.get('model_state_dict')
        expected = model.state_dict()
        if not isinstance(state, dict) or set(state) != set(expected):
            raise ValueError("MAML model state keys do not match")
        for key, reference in expected.items():
            value = state[key]
            if (not isinstance(value, torch.Tensor) or value.shape != reference.shape
                    or value.dtype != reference.dtype or not torch.isfinite(value).all()):
                raise ValueError("MAML model state must have matching finite tensors")
        adam = checkpoint.get('optimizer_state_dict')
        if not isinstance(adam, dict) or set(adam) != {'state', 'param_groups'}:
            raise ValueError("MAML checkpoint must contain compatible Adam state")
        groups = adam['param_groups']
        if not isinstance(groups, list) or len(groups) != len(optimizer.param_groups):
            raise ValueError("MAML Adam parameter groups do not match")
        saved_ids = []
        parameters = []
        for group, reference in zip(groups, optimizer.param_groups):
            if (not isinstance(group, dict)
                    or not {'params', 'lr', 'betas', 'eps', 'weight_decay', 'amsgrad'}.issubset(group)
                    or not set(group).issubset(optimizer.state_dict()['param_groups'][0])):
                raise ValueError("MAML Adam group schema does not match")
            ids = group['params']
            if not isinstance(ids, list) or len(ids) != len(reference['params']):
                raise ValueError("MAML Adam parameter groups do not match")
            if ids != optimizer.state_dict()['param_groups'][0]['params']:
                raise ValueError("MAML Adam parameter ordering does not match")
            if any(type(item) is not int for item in ids):
                raise ValueError("MAML Adam parameter IDs must be integers")
            saved_ids.extend(ids)
            parameters.extend(reference['params'])
            for name in ('lr', 'eps', 'weight_decay'):
                value = group[name]
                if (type(value) not in (int, float) or not math.isfinite(value) or value < 0):
                    raise ValueError("MAML Adam hyperparameters must be finite and nonnegative")
            betas = group['betas']
            if (not isinstance(betas, (tuple, list)) or len(betas) != 2
                    or any(type(value) not in (int, float) or not math.isfinite(value)
                           or not 0 <= value < 1 for value in betas)):
                raise ValueError("MAML Adam betas must lie in [0,1)")
            for name in ('amsgrad', 'maximize', 'capturable', 'differentiable', 'decoupled_weight_decay'):
                if name in group and type(group[name]) is not bool:
                    raise ValueError("MAML Adam flags must be booleans")
            # This implementation uses ordinary Adam; reject incompatible execution
            # modes rather than publishing a pair that fails on the next CPU step.
            if group.get('capturable', False) or group.get('differentiable', False) or group.get('decoupled_weight_decay', False):
                raise ValueError("MAML checkpoint uses an unsupported Adam execution mode")
            for name in ('foreach', 'fused'):
                if group.get(name) is not None and type(group[name]) is not bool:
                    raise ValueError("MAML Adam execution flags must be boolean or None")
            if group.get('foreach') and group.get('fused'):
                raise ValueError("MAML Adam foreach and fused modes cannot both be enabled")
        if len(set(saved_ids)) != len(saved_ids):
            raise ValueError("MAML Adam parameter IDs must be unique")
        states = adam['state']
        if (not isinstance(states, dict) or any(type(key) is not int for key in states)
                or not set(states).issubset(saved_ids)):
            raise ValueError("MAML Adam state references unknown parameters")
        by_id = dict(zip(saved_ids, parameters))
        for group in groups:
            for identifier in group['params']:
                if identifier not in states:
                    continue  # Valid uninitialized Adam parameter.
                entry = states[identifier]
                required = {'step', 'exp_avg', 'exp_avg_sq'}
                if group['amsgrad']:
                    required.add('max_exp_avg_sq')
                if not isinstance(entry, dict) or set(entry) != required:
                    raise ValueError("MAML Adam moment schema does not match")
                step = entry['step']
                if (not isinstance(step, torch.Tensor) or step.numel() != 1
                        or not torch.isfinite(step).all() or step.item() < 0
                        or step.item() != int(step.item())):
                    raise ValueError("MAML Adam step must be a finite nonnegative integer scalar")
                parameter = by_id[identifier]
                for name in required - {'step'}:
                    moment = entry[name]
                    if (not isinstance(moment, torch.Tensor) or moment.shape != parameter.shape
                            or moment.dtype != parameter.dtype or not torch.isfinite(moment).all()
                            or (name != 'exp_avg' and (moment < 0).any())):
                        raise ValueError("MAML Adam moments must match finite parameter tensors")
        model.load_state_dict(state, strict=True)
        optimizer.load_state_dict(adam)

    def load(self, path: str = "models/maml_model.pth"):
        """Validate privately and publish one coherent native generation."""
        checkpoint = torch.load(path, map_location=self.device, weights_only=True)
        with self._generation_lock:
            candidate_model = copy.deepcopy(self.model)
            candidate_model.zero_grad(set_to_none=True)
            candidate_optimizer = torch.optim.Adam(candidate_model.parameters(), lr=self.outer_lr)
            self._validate_checkpoint_pair(candidate_model, candidate_optimizer, checkpoint)
            self._generation = (candidate_model, candidate_optimizer)
        logger.info("MAML model loaded from %s", path)

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
        adapted_model = self.maml.adapt(support_x_t, support_y_t, steps, training=False)
        
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
        adapted_model = self.maml.adapt(support_x_t, support_y_t.float().unsqueeze(1), steps, training=False)
        
        # Predict
        predictions = self.maml.predict(adapted_model, query_x_t)
        classes = torch.round(predictions).squeeze().int()
        
        return classes.cpu().numpy()

class TaskGenerationUnavailable(ValueError):
    """The selected task cannot yield finite truth-aligned binary samples."""


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
    
    @staticmethod
    def _normal_above(lower, count):
        """Draw a conditional standard normal with one finite proposal batch.

        Positive tails use an exponential envelope; negative thresholds accept
        more than half of standard-normal proposals. No rare-class retry loop.
        """
        budget = 4 * count + 64
        if lower >= 0:
            rate = lower / 2 + np.hypot(lower / 2, 1.0)
            values = lower + np.random.exponential(1 / rate, budget)
            acceptance = np.exp(-0.5 * (values - rate) ** 2)
            accepted = values[(values > lower) & (np.random.random(budget) < acceptance)]
        else:
            values = np.random.randn(budget)
            accepted = values[values > lower]
        if len(accepted) < count or not np.isfinite(accepted[:count]).all():
            raise TaskGenerationUnavailable("Binary support sampling budget exhausted")
        return accepted[:count]

    def generate_few_shot_task(self, k_shot: int = 5, num_classes: int = 2) -> Dict:
        """Generate support and query labels from the same binary linear task."""
        if isinstance(k_shot, bool) or not isinstance(k_shot, (int, np.integer)) or k_shot <= 0:
            raise ValueError("k_shot must be a positive integer")
        if num_classes != 2:
            raise ValueError("Linear threshold tasks support exactly two classes")
        if not self.tasks:
            raise TaskGenerationUnavailable("No binary tasks available")
        task = np.random.choice(self.tasks)
        weights = np.asarray(task['weights'], dtype=float).reshape(-1).copy()
        bias = np.asarray(task['bias'], dtype=float).reshape(-1)
        if weights.shape != (self.input_dim,) or not weights.size or bias.size != 1:
            raise TaskGenerationUnavailable("Invalid binary task feature dimensions")
        if not np.isfinite(weights).all() or not np.isfinite(bias).all():
            raise TaskGenerationUnavailable("Binary task coefficients must be finite")
        scale = float(np.abs(weights).max())
        if not scale:
            raise TaskGenerationUnavailable("Constant tasks cannot supply both binary classes")
        scaled = weights / scale
        norm = np.linalg.norm(scaled)
        direction = scaled / norm
        threshold = -(float(bias[0]) / scale) / norm
        if not np.isfinite(threshold):
            raise TaskGenerationUnavailable("Binary boundary cannot be represented")

        support_set = {}
        for cls in (0, 1):
            # The normal component is conditional; its independent orthogonal
            # Gaussian component is unchanged. This preserves the correct
            # Gaussian distribution within each task halfspace.
            values = self._normal_above(threshold if cls else -threshold, k_shot)
            if not cls:
                values = -values
            rows = np.random.randn(k_shot, self.input_dim)
            rows -= np.outer(rows @ direction, direction)
            rows += np.outer(values, direction)
            actual = (rows @ direction > threshold).astype(int)
            if not np.isfinite(rows).all() or not (actual == cls).all():
                raise TaskGenerationUnavailable("Binary boundary is numerically unresolved")
            support_set[str(cls)] = rows

        query_x = np.random.randn(10, self.input_dim)
        query_y = (query_x @ direction > threshold).astype(int).reshape(-1, 1)
        return {
            'support_set': support_set,
            'query_x': query_x,
            'query_y': query_y
        }
