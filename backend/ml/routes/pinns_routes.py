import logging
import os
from datetime import datetime
from functools import wraps
from typing import List, Literal

import torch
from fastapi import APIRouter, HTTPException
from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer
from pinns.training_transition import PINNInputError, loop_policy
from pydantic import BaseModel, Field, StrictInt

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/pinns", tags=["Physics-Informed Neural Networks"])

# Initialize model
input_dim = 2
hidden_dim = 256
output_dim = 1
num_layers = 6

model = PhysicsInformedNN(input_dim, hidden_dim, output_dim, num_layers)
physics_loss = PhysicsLoss('diffusion')
trainer = PINNTrainer(model, physics_loss)


def serialized_native(function):
    @wraps(function)
    def operation(*args, **kwargs):
        with trainer._operation_lock:
            return function(*args, **kwargs)
    return operation


class TrainRequest(BaseModel):
    epochs: StrictInt = Field(default=1, ge=1, le=1000)
    batch_size: StrictInt = Field(default=32, ge=1, le=4096)
    data_points: StrictInt = Field(default=32, ge=1, le=10000)
    phys_points: StrictInt = Field(default=32, ge=1, le=10000)
    physics_type: Literal['diffusion', 'advection', 'burger', 'poisson'] = 'diffusion'

@router.post("/train")
@serialized_native
def train_pinns(request: TrainRequest):
    """Train PINN model"""
    try:
        loop_policy(trainer, request.data_points, request.phys_points, request.epochs, request.batch_size)
        # Generate synthetic data
        # Domain: x in [-1, 1]
        x_data = torch.rand(request.data_points, input_dim) * 2 - 1
        y_data = torch.sin(x_data[:, 0:1]) * torch.cos(x_data[:, 1:2])
        
        # Physics points
        x_phys = torch.rand(request.phys_points, input_dim) * 2 - 1
        
        # Request-specific toy physics selection is owned by the native worker,
        # including cancellation; restore the shared configuration on exit.
        with trainer._operation_lock:
            previous_kind = trainer.physics_loss.physics_type
            try:
                trainer.physics_loss.physics_type = request.physics_type
                results = trainer.train(x_data, y_data, x_phys,
                                        epochs=request.epochs, batch_size=request.batch_size)
            finally:
                trainer.physics_loss.physics_type = previous_kind
        
        return {
            'success': True,
            'data': {
                'final_loss': results['final_loss'],
                'final_data_loss': results['final_data_loss'],
                'final_physics_loss': results['final_physics_loss'],
                'epochs': request.epochs,
                'physics_type': request.physics_type
            },
            'timestamp': datetime.now().isoformat()
        }
    except PINNInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as e:
        logger.error(f"Training failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/predict")
@serialized_native
def predict_pinns(x: List[List[float]]):
    """Make predictions using PINN"""
    try:
        x_tensor = torch.tensor(x, dtype=torch.float32)
        predictions = trainer.predict(x_tensor)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'shape': list(predictions.shape)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/model-info")
@serialized_native
def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'input_dim': input_dim,
                'hidden_dim': hidden_dim,
                'output_dim': output_dim,
                'num_layers': num_layers,
                'parameters': sum(p.numel() for p in model.parameters()),
                'trainable': sum(p.numel() for p in model.parameters() if p.requires_grad),
                'device': str(trainer.device),
                'physics_type': physics_loss.physics_type
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/save")
@serialized_native
def save_model(path: str = "models/pinns_model.pth"):
    path = os.path.join("models", os.path.basename(path))
    """Save PINN model"""
    try:
        trainer.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/load")
@serialized_native
def load_model(path: str = "models/pinns_model.pth"):
    path = os.path.join("models", os.path.basename(path))
    """Load PINN model"""
    try:
        trainer.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")