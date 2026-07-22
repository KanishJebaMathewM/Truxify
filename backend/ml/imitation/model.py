import torch
import torch.nn as nn
import torch.nn.functional as F
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
import logging
from collections import deque
import random

logger = logging.getLogger(__name__)

class BehavioralCloning(nn.Module):
    """Behavioral Cloning for driver behavior modeling"""
    
    def __init__(
        self,
        state_dim: int = 64,
        action_dim: int = 4,
        hidden_dim: int = 256
    ):
        super().__init__()
        
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim
        
        self.policy = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Linear(hidden_dim, action_dim)
        )
        
        logger.info(f"✅ Behavioral Cloning initialized: state_dim={state_dim}, action_dim={action_dim}")
    
    def forward(self, state: torch.Tensor) -> torch.Tensor:
        return self.policy(state)
    
    def predict_action(self, state: np.ndarray) -> np.ndarray:
        """Predict action from state"""
        self.eval()
        with torch.no_grad():
            state_tensor = torch.tensor(state, dtype=torch.float32)
            if len(state_tensor.shape) == 1:
                state_tensor = state_tensor.unsqueeze(0)
            action = self(state_tensor)
        return action.cpu().numpy()

class InverseRL:
    """Inverse Reinforcement Learning for reward inference"""
    
    def __init__(
        self,
        state_dim: int = 64,
        action_dim: int = 4,
        hidden_dim: int = 256
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim
        
        self.reward_model = nn.Sequential(
            nn.Linear(state_dim + action_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, 1)
        )
        
        self.optimizer = torch.optim.Adam(self.reward_model.parameters(), lr=1e-3)
        
        logger.info(f"✅ Inverse RL initialized")
    
    def infer_reward(self, state: np.ndarray, action: np.ndarray) -> float:
        """Infer reward from state-action pair"""
        self.reward_model.eval()
        with torch.no_grad():
            state_tensor = torch.tensor(state, dtype=torch.float32)
            action_tensor = torch.tensor(action, dtype=torch.float32)
            if len(state_tensor.shape) == 1:
                state_tensor = state_tensor.unsqueeze(0)
            if len(action_tensor.shape) == 1:
                action_tensor = action_tensor.unsqueeze(0)
            
            combined = torch.cat([state_tensor, action_tensor], dim=-1)
            reward = self.reward_model(combined)
        return reward.item()
    
    def train_reward_model(
        self,
        expert_states: np.ndarray,
        expert_actions: np.ndarray,
        learner_states: np.ndarray,
        learner_actions: np.ndarray,
        epochs: int = 100
    ) -> Dict:
        """Train reward model using IRL"""
        losses = []
        
        for epoch in range(epochs):
            # Convert to tensors
            expert_states_t = torch.tensor(expert_states, dtype=torch.float32)
            expert_actions_t = torch.tensor(expert_actions, dtype=torch.float32)
            learner_states_t = torch.tensor(learner_states, dtype=torch.float32)
            learner_actions_t = torch.tensor(learner_actions, dtype=torch.float32)
            
            # Expert rewards
            expert_combined = torch.cat([expert_states_t, expert_actions_t], dim=-1)
            expert_rewards = self.reward_model(expert_combined)
            
            # Learner rewards
            learner_combined = torch.cat([learner_states_t, learner_actions_t], dim=-1)
            learner_rewards = self.reward_model(learner_combined)
            
            # Loss: maximize expert rewards, minimize learner rewards
            loss = -torch.mean(expert_rewards) + torch.mean(learner_rewards)
            
            # Backward pass
            self.optimizer.zero_grad()
            loss.backward()
            self.optimizer.step()
            
            losses.append(loss.item())
            
            if (epoch + 1) % 20 == 0:
                logger.info(f"IRL Epoch {epoch+1}/{epochs}: Loss={loss.item():.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1]
        }

class PolicyGradient:
    """Policy Gradient for behavior learning"""
    
    def __init__(
        self,
        state_dim: int = 64,
        action_dim: int = 4,
        hidden_dim: int = 256,
        lr: float = 1e-3
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim
        
        self.policy = nn.Sequential(
            nn.Linear(state_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, hidden_dim),
            nn.ReLU(),
            nn.Dropout(0.2),
            nn.Linear(hidden_dim, action_dim),
            nn.Softmax(dim=-1)
        )
        
        self.optimizer = torch.optim.Adam(self.policy.parameters(), lr=lr)
        
        logger.info(f"✅ Policy Gradient initialized")
    
    def get_action(self, state: np.ndarray, explore: bool = True) -> np.ndarray:
        """Get action from policy"""
        self.policy.eval()
        with torch.no_grad():
            state_tensor = torch.tensor(state, dtype=torch.float32)
            if len(state_tensor.shape) == 1:
                state_tensor = state_tensor.unsqueeze(0)
            action_probs = self.policy(state_tensor)
            
            if explore:
                action = torch.multinomial(action_probs, 1).item()
            else:
                action = torch.argmax(action_probs).item()
            
            return action
    
    def train_step(
        self,
        states: np.ndarray,
        actions: np.ndarray,
        rewards: np.ndarray
    ) -> float:
        """Single training step with REINFORCE"""
        self.policy.train()
        
        states_t = torch.tensor(states, dtype=torch.float32)
        actions_t = torch.tensor(actions, dtype=torch.long)
        rewards_t = torch.tensor(rewards, dtype=torch.float32)
        
        # Forward pass
        action_probs = self.policy(states_t)
        
        # Compute log probabilities
        log_probs = torch.log(action_probs.gather(1, actions_t.unsqueeze(1)).squeeze())
        
        # Compute loss
        loss = -torch.mean(log_probs * rewards_t)
        
        # Backward pass
        self.optimizer.zero_grad()
        loss.backward()
        torch.nn.utils.clip_grad_norm_(self.policy.parameters(), 1.0)
        self.optimizer.step()
        
        return loss.item()
    
    def train(
        self,
        trajectories: List[Dict],
        epochs: int = 100,
        batch_size: int = 32
    ) -> Dict:
        """Train policy using REINFORCE"""
        losses = []
        
        # Prepare data
        all_states = []
        all_actions = []
        all_rewards = []
        
        for traj in trajectories:
            all_states.extend(traj['states'])
            all_actions.extend(traj['actions'])
            all_rewards.extend(traj['rewards'])
        
        states = np.array(all_states)
        actions = np.array(all_actions)
        rewards = np.array(all_rewards)
        
        # Normalize rewards
        rewards = (rewards - np.mean(rewards)) / (np.std(rewards) + 1e-8)
        
        for epoch in range(epochs):
            # Shuffle data
            indices = np.random.permutation(len(states))
            states_shuffled = states[indices]
            actions_shuffled = actions[indices]
            rewards_shuffled = rewards[indices]
            
            total_loss = 0
            num_batches = 0
            
            for i in range(0, len(states), batch_size):
                batch_states = states_shuffled[i:i+batch_size]
                batch_actions = actions_shuffled[i:i+batch_size]
                batch_rewards = rewards_shuffled[i:i+batch_size]
                
                loss = self.train_step(batch_states, batch_actions, batch_rewards)
                total_loss += loss
                num_batches += 1
            
            avg_loss = total_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 20 == 0:
                logger.info(f"Policy Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1]
        }

class SafetyConstraints:
    """Safety constraints for driver behavior"""
    
    def __init__(self):
        self.safety_rules = []
        
        logger.info(f"✅ Safety Constraints initialized")
    
    def add_rule(self, rule: Dict):
        """Add safety rule"""
        self.safety_rules.append(rule)
    
    def check_safety(self, state: np.ndarray, action: np.ndarray) -> Tuple[bool, str]:
        """Check if action is safe"""
        for rule in self.safety_rules:
            if rule['type'] == 'speed':
                if self._check_speed_rule(state, action, rule):
                    return False, f"Speed violation: {rule['description']}"
            
            elif rule['type'] == 'lane':
                if self._check_lane_rule(state, action, rule):
                    return False, f"Lane violation: {rule['description']}"
            
            elif rule['type'] == 'distance':
                if self._check_distance_rule(state, action, rule):
                    return False, f"Distance violation: {rule['description']}"
            
            elif rule['type'] == 'brake':
                if self._check_brake_rule(state, action, rule):
                    return False, f"Brake violation: {rule['description']}"
        
        return True, "Safe"
    
    def _check_speed_rule(self, state: np.ndarray, action: np.ndarray, rule: Dict) -> bool:
        """Check speed limit rule"""
        speed = state[0] if len(state) > 0 else 0
        max_speed = rule.get('max_speed', 80)
        return speed > max_speed
    
    def _check_lane_rule(self, state: np.ndarray, action: np.ndarray, rule: Dict) -> bool:
        """Check lane keeping rule"""
        lane_deviation = state[1] if len(state) > 1 else 0
        max_deviation = rule.get('max_deviation', 0.5)
        return abs(lane_deviation) > max_deviation
    
    def _check_distance_rule(self, state: np.ndarray, action: np.ndarray, rule: Dict) -> bool:
        """Check following distance rule"""
        distance = state[2] if len(state) > 2 else 100
        min_distance = rule.get('min_distance', 50)
        return distance < min_distance
    
    def _check_brake_rule(self, state: np.ndarray, action: np.ndarray, rule: Dict) -> bool:
        """Check braking rule"""
        brake = action[2] if len(action) > 2 else 0
        max_brake = rule.get('max_brake', 0.8)
        return brake > max_brake
    
    def get_default_rules(self) -> List[Dict]:
        """Get default safety rules"""
        return [
            {'type': 'speed', 'max_speed': 80, 'description': 'Speed limit 80 km/h'},
            {'type': 'lane', 'max_deviation': 0.5, 'description': 'Lane deviation limit'},
            {'type': 'distance', 'min_distance': 50, 'description': 'Minimum following distance'},
            {'type': 'brake', 'max_brake': 0.8, 'description': 'Maximum braking force'}
        ]

class ImitationLearningModel:
    """Complete Imitation Learning Model"""
    
    def __init__(
        self,
        state_dim: int = 64,
        action_dim: int = 4,
        hidden_dim: int = 256
    ):
        self.state_dim = state_dim
        self.action_dim = action_dim
        self.hidden_dim = hidden_dim
        
        self.behavioral_cloning = BehavioralCloning(state_dim, action_dim, hidden_dim)
        self.inverse_rl = InverseRL(state_dim, action_dim, hidden_dim)
        self.policy_gradient = PolicyGradient(state_dim, action_dim, hidden_dim)
        self.safety = SafetyConstraints()
        
        self.bc_optimizer = torch.optim.Adam(self.behavioral_cloning.parameters(), lr=1e-3)
        
        logger.info(f"✅ Imitation Learning Model initialized")
    
    def train_behavioral_cloning(
        self,
        expert_states: np.ndarray,
        expert_actions: np.ndarray,
        epochs: int = 100,
        batch_size: int = 32
    ) -> Dict:
        """Train behavioral cloning"""
        losses = []
        
        for epoch in range(epochs):
            # Shuffle data
            indices = np.random.permutation(len(expert_states))
            states_shuffled = expert_states[indices]
            actions_shuffled = expert_actions[indices]
            
            total_loss = 0
            num_batches = 0
            
            for i in range(0, len(expert_states), batch_size):
                batch_states = torch.tensor(states_shuffled[i:i+batch_size], dtype=torch.float32)
                batch_actions = torch.tensor(actions_shuffled[i:i+batch_size], dtype=torch.float32)
                
                # Forward pass
                pred_actions = self.behavioral_cloning(batch_states)
                loss = F.mse_loss(pred_actions, batch_actions)
                
                # Backward pass
                self.bc_optimizer.zero_grad()
                loss.backward()
                self.bc_optimizer.step()
                
                total_loss += loss.item()
                num_batches += 1
            
            avg_loss = total_loss / num_batches
            losses.append(avg_loss)
            
            if (epoch + 1) % 20 == 0:
                logger.info(f"BC Epoch {epoch+1}/{epochs}: Loss={avg_loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1]
        }
    
    def train_irl(
        self,
        expert_states: np.ndarray,
        expert_actions: np.ndarray,
        learner_states: np.ndarray,
        learner_actions: np.ndarray,
        epochs: int = 100
    ) -> Dict:
        """Train inverse reinforcement learning"""
        return self.inverse_rl.train_reward_model(
            expert_states, expert_actions,
            learner_states, learner_actions,
            epochs
        )
    
    def train_policy(
        self,
        trajectories: List[Dict],
        epochs: int = 100
    ) -> Dict:
        """Train policy with reinforcement learning"""
        return self.policy_gradient.train(trajectories, epochs)
    
    def predict_action(self, state: np.ndarray, safety_check: bool = True) -> Dict:
        """Predict action with safety check"""
        # Behavioral cloning prediction
        bc_action = self.behavioral_cloning.predict_action(state)
        
        # Policy gradient prediction
        pg_action = self.policy_gradient.get_action(state, explore=False)
        
        # Combine predictions
        action = (bc_action + pg_action) / 2
        action = np.clip(action, -1, 1)
        
        # Safety check
        if safety_check:
            is_safe, message = self.safety.check_safety(state, action)
            if not is_safe:
                logger.warning(f"Unsafe action detected: {message}")
                # Adjust action to be safe
                action = self._adjust_action(state, action)
        
        return {
            'action': action.tolist(),
            'bc_action': bc_action.tolist(),
            'pg_action': pg_action.tolist(),
            'safe': safety_check,
            'message': 'Safe' if safety_check else 'Unsafe'
        }
    
    def _adjust_action(self, state: np.ndarray, action: np.ndarray) -> np.ndarray:
        """Adjust action to satisfy safety constraints"""
        adjusted = action.copy()
        
        # Reduce speed if unsafe
        speed = state[0] if len(state) > 0 else 0
        if speed > 80:
            adjusted[0] = min(adjusted[0], 0)  # Slow down
        
        # Correct lane deviation
        lane_dev = state[1] if len(state) > 1 else 0
        if abs(lane_dev) > 0.5:
            adjusted[1] = -np.sign(lane_dev) * 0.2  # Correct steering
        
        # Maintain distance
        distance = state[2] if len(state) > 2 else 100
        if distance < 50:
            adjusted[0] = min(adjusted[0], -0.3)  # Brake
        
        return adjusted
    
    def save(self, path: str = "models/imitation_model.pth"):
        """Save model"""
        torch.save({
            'bc_state_dict': self.behavioral_cloning.state_dict(),
            'irl_state_dict': self.inverse_rl.reward_model.state_dict(),
            'pg_state_dict': self.policy_gradient.policy.state_dict(),
            'bc_optimizer_state_dict': self.bc_optimizer.state_dict()
        }, path)
        logger.info(f"✅ Model saved to {path}")
    
    def load(self, path: str = "models/imitation_model.pth"):
        """Load model"""
        checkpoint = torch.load(path, map_location='cpu')
        self.behavioral_cloning.load_state_dict(checkpoint['bc_state_dict'])
        self.inverse_rl.reward_model.load_state_dict(checkpoint['irl_state_dict'])
        self.policy_gradient.policy.load_state_dict(checkpoint['pg_state_dict'])
        self.bc_optimizer.load_state_dict(checkpoint['bc_optimizer_state_dict'])
        logger.info(f"✅ Model loaded from {path}")