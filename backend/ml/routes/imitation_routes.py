from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import numpy as np
from datetime import datetime
import logging
from imitation.model import ImitationLearningModel

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/imitation", tags=["Imitation Learning"])

# Initialize model
state_dim = 64
action_dim = 4
hidden_dim = 256

model = ImitationLearningModel(state_dim, action_dim, hidden_dim)

class TrainRequest(BaseModel):
    epochs: int = 100
    batch_size: int = 32
    data_size: int = 1000

@router.post("/train/bc")
async def train_behavioral_cloning(request: TrainRequest):
    """Train behavioral cloning model"""
    try:
        # Generate synthetic expert data
        X = np.random.randn(request.data_size, state_dim)
        y = np.random.randn(request.data_size, action_dim)
        
        # Clip actions to valid range
        y = np.clip(y, -1, 1)
        
        results = model.train_behavioral_cloning(X, y, request.epochs, request.batch_size)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"BC training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train/irl")
async def train_inverse_rl(request: TrainRequest):
    """Train inverse reinforcement learning"""
    try:
        # Generate synthetic data
        expert_states = np.random.randn(request.data_size, state_dim)
        expert_actions = np.random.randn(request.data_size, action_dim)
        learner_states = np.random.randn(request.data_size, state_dim)
        learner_actions = np.random.randn(request.data_size, action_dim)
        
        results = model.train_irl(
            expert_states, expert_actions,
            learner_states, learner_actions,
            request.epochs
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"IRL training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train/policy")
async def train_policy(request: TrainRequest):
    """Train policy with reinforcement learning"""
    try:
        # Generate synthetic trajectories
        trajectories = []
        for _ in range(10):
            traj = {
                'states': np.random.randn(100, state_dim).tolist(),
                'actions': np.random.randint(0, action_dim, 100).tolist(),
                'rewards': np.random.randn(100).tolist()
            }
            trajectories.append(traj)
        
        results = model.train_policy(trajectories, request.epochs)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Policy training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict_action(state: List[float], safety_check: bool = True):
    """Predict action from state"""
    try:
        if len(state) != state_dim:
            return {
                'success': False,
                'error': f'Expected {state_dim} dimensions, got {len(state)}'
            }
        
        state_np = np.array(state)
        result = model.predict_action(state_np, safety_check)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/safety/rules")
async def get_safety_rules():
    """Get default safety rules"""
    try:
        rules = model.safety.get_default_rules()
        return {
            'success': True,
            'data': rules,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Safety rules fetch failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/safety/rules/add")
async def add_safety_rule(rule: Dict):
    """Add safety rule"""
    try:
        model.safety.add_rule(rule)
        return {
            'success': True,
            'message': 'Safety rule added',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Add safety rule failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'state_dim': state_dim,
                'action_dim': action_dim,
                'hidden_dim': hidden_dim,
                'parameters': sum(p.numel() for p in model.behavioral_cloning.parameters())
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/imitation_model.pth"):
    """Save imitation learning model"""
    try:
        model.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/imitation_model.pth"):
    """Load imitation learning model"""
    try:
        model.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))