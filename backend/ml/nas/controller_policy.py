"""Bounded native on-policy categorical architecture controller."""
import math
from copy import deepcopy
from numbers import Integral, Real
from threading import RLock
from uuid import uuid4

import torch
from torch import nn


def _integer(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, Integral) or not low <= value <= high:
        raise ValueError(f"{name} must be an integer in [{low}, {high}]")
    return int(value)


def _reward(value):
    if isinstance(value, bool) or not isinstance(value, Real):
        raise ValueError("reward must be a finite real number within +/-1e6")  # noqa: TRY004 - uniform admission
    try:
        value = float(value)
    except OverflowError as exc:
        raise ValueError("reward must be representable within bounds") from exc
    if not math.isfinite(value) or abs(value) > 1e6:
        raise ValueError("reward must be a finite real number within +/-1e6")
    return value


class _Policy(nn.Module):
    def __init__(self, sizes):
        super().__init__()
        self.sizes = sizes
        self.offsets = [sum(sizes[:i]) for i in range(4)]
        self.bos = sum(sizes)
        self.embedding = nn.Embedding(self.bos + 1, 64)
        self.cell = nn.LSTMCell(64, 128)
        self.heads = nn.ModuleList(nn.Linear(128, size) for size in sizes)

    def step(self, previous, state, kind):
        weight = self.embedding.weight
        token = torch.tensor([previous], device=weight.device)
        state = self.cell(self.embedding(token), state)
        logits = self.heads[kind](state[0]).squeeze(0)
        if not bool(torch.isfinite(logits).all()):
            raise RuntimeError("native controller produced nonfinite logits")
        return logits, state


class RLNASController:
    """One outstanding owned trajectory; REINFORCE uses a prior EMA baseline.

    Scores are supplied observations, not controller-predicted accuracy. Native
    CPU float32/64 only. The old nonfunctional stub checkpoint is incompatible.
    """

    def __init__(self, search_space):
        self.search_space = search_space
        self._lock = RLock()
        self.operations = tuple(search_space.operations)
        self.activations = tuple(search_space.activation_functions)
        from nas.model import NASSearchSpace
        supported = NASSearchSpace()
        if (any(v not in supported.operations for v in self.operations)
                or any(v not in supported.activation_functions for v in self.activations)):
            raise ValueError("controller choices must be supported NAS operations/activations")
        if (not self.operations or len(self.operations) > 64 or len(set(self.operations)) != len(self.operations)
                or not self.activations or len(self.activations) > 64
                or len(set(self.activations)) != len(self.activations)
                or any(not isinstance(v, str) for v in self.operations + self.activations)):
            raise ValueError("search choices must be distinct bounded strings")
        low, high = search_space.num_layers_range
        low = _integer(low, "minimum depth", 1, 32)
        high = _integer(high, "maximum depth", low, 32)
        self.depths = tuple(range(low, high + 1))
        low, high = search_space.num_filters_range
        low = _integer(low, "minimum filters", 1, 4096)
        high = _integer(high, "maximum filters", low, 4096)
        self.filters = tuple(v for v in range(low, high + 1) if v % 8 == 0)
        if not self.filters or len(self.filters) > 128:
            raise ValueError("filter choices must contain 1..128 multiples of eight")
        self.controller = _Policy(tuple(map(len, (self.depths, self.operations, self.filters, self.activations))))
        self.optimizer = torch.optim.Adam(self.controller.parameters(), lr=.001)
        self.best_architecture = None
        self.best_accuracy = -math.inf
        self.baseline = 0.0
        self.updates = 0
        self._instance_id = uuid4().hex
        self._sample_serial = 0
        self._pending = None

    def _admit_policy(self):
        parameters = list(self.controller.parameters())
        dtype = parameters[0].dtype
        if dtype not in (torch.float32, torch.float64) or any(
                p.device.type != "cpu" or p.dtype != dtype or not bool(torch.isfinite(p).all())
                for p in parameters):
            raise ValueError("controller requires coherent finite CPU float32/float64 parameters")
        if len(self.optimizer.param_groups) != 1 or [id(p) for p in self.optimizer.param_groups[0]['params']] != [id(p) for p in parameters]:
            raise ValueError("controller requires its original single-group Adam ownership")
        group = self.optimizer.param_groups[0]
        for name in ('lr', 'eps', 'weight_decay'):
            value = group[name]
            if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0 or (name == 'eps' and value == 0):
                raise ValueError("Adam policy must be finite and nonnegative with positive epsilon")
        if any(not isinstance(v, Real) or isinstance(v, bool) or not math.isfinite(v) or not 0 <= v < 1 for v in group['betas']):
            raise ValueError("Adam beta policy must lie in [0,1)")
        if not math.isfinite(self.baseline) or abs(self.baseline) > 1e6:
            raise ValueError("controller baseline must be finite within reward bounds")
        for parameter, state in self.optimizer.state.items():
            if any(isinstance(v, torch.Tensor) and not bool(torch.isfinite(v).all()) for v in state.values()):
                raise ValueError("Adam moments must be finite")
            for key in ('exp_avg', 'exp_avg_sq', 'max_exp_avg_sq'):
                if key in state and (state[key].shape != parameter.shape or state[key].dtype != dtype
                                     or state[key].device != parameter.device):
                    raise ValueError("Adam moments must match their registered policy parameters")

    def _decode(self, actions=None):
        previous, state = self.controller.bos, None
        result, log_probs = [], []
        depth = None
        for position in range(1 + 3 * max(self.depths)):
            kind = 0 if position == 0 else 1 + (position - 1) % 3
            logits, state = self.controller.step(previous, state, kind)
            distribution = torch.distributions.Categorical(logits=logits)
            action = distribution.sample() if actions is None else torch.tensor(actions[position])
            index = int(action)
            result.append(index)
            log_probs.append(distribution.log_prob(action))
            previous = self.controller.offsets[kind] + index
            if position == 0:
                depth = self.depths[index]
            if position == 3 * depth:
                break
        return result, torch.stack(log_probs).sum()

    def _architecture(self, actions):
        depth = self.depths[actions[0]]
        return {'layers': [self.operations[actions[1 + 3 * i]] for i in range(depth)],
                'filters': [self.filters[actions[2 + 3 * i]] for i in range(depth)],
                'activations': [self.activations[actions[3 + 3 * i]] for i in range(depth)]}

    def sample_architecture(self):
        with self._lock:
            if self._pending is not None:
                raise ValueError("consume or discard the outstanding on-policy sample first")
            self._admit_policy()
            with torch.no_grad():
                actions, log_probability = self._decode()
            if not bool(torch.isfinite(log_probability)):
                raise RuntimeError("native trajectory probability must be finite")
            architecture = self._architecture(actions)
            self._sample_serial += 1
            # Identical genotypes can arise under distinct on-policy samples.
            # Keep an explicit ticket so an older returned dictionary cannot
            # receive the newer sample's reward merely because its fields match.
            architecture['controller_sample_id'] = f"{self._instance_id}:{self._sample_serial}"
            self._pending = (deepcopy(architecture), tuple(actions),
                             [p.detach().clone() for p in self.controller.parameters()])
            return deepcopy(architecture)

    def discard_sample(self):
        """Release an unevaluated sample; this does not undo sampling RNG."""
        with self._lock:
            self._pending = None

    def update_controller(self, architecture, reward):
        with self._lock:
            reward = _reward(reward)
            self._admit_policy()
            if self._pending is None:
                raise ValueError("reward requires an outstanding on-policy sample")
            owned, actions, sampled_parameters = self._pending
            if architecture != owned:
                raise ValueError("reward architecture differs from the owned sampled trajectory")
            if any(p.dtype != old.dtype or p.device != old.device or not torch.equal(p, old)
                   for p, old in zip(self.controller.parameters(), sampled_parameters)):
                raise ValueError("sample belongs to a changed policy; discard and resample")
            advantage = reward - self.baseline
            params = list(self.controller.parameters())
            state = deepcopy(self.optimizer.state_dict())
            gradients = [None if p.grad is None else p.grad.clone() for p in params]
            try:
                self.optimizer.zero_grad(set_to_none=True)
                _, log_probability = self._decode(actions)
                loss = -advantage * log_probability
                if not bool(torch.isfinite(loss)):
                    raise RuntimeError("native policy objective must be finite")
                if advantage:
                    loss.backward()
                    if any(p.grad is not None and not bool(torch.isfinite(p.grad).all()) for p in params):
                        raise RuntimeError("native policy gradients must be finite")
                    self.optimizer.step()
                    try:
                        self._admit_policy()
                    except ValueError as exc:
                        raise RuntimeError("native Adam candidate is nonfinite") from exc
            except Exception:
                with torch.no_grad():
                    for p, old in zip(params, sampled_parameters):
                        p.copy_(old)
                self.optimizer.load_state_dict(state)
                for p, gradient in zip(params, gradients):
                    p.grad = gradient
                raise
            self.baseline = .9 * self.baseline + .1 * reward
            self.updates += 1
            if reward > self.best_accuracy:
                self.best_accuracy, self.best_architecture = reward, deepcopy(owned)
            self._pending = None
            return {'loss': float(loss.detach()), 'reward': reward, 'advantage': advantage,
                    'baseline': self.baseline, 'updates': self.updates}
