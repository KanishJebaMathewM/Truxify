from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from pinns.model import PhysicsInformedNN, PhysicsLoss, PINNTrainer

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

class TrainRequest(BaseModel):
    epochs: int = 1000
    batch_size: int = 32
    data_points: int = 1000
    phys_points: int = 5000
    physics_type: str = 'diffusion'

@router.post("/train")
async def train_pinns(request: TrainRequest):
    """Train PINN model"""
    try:
        # Generate synthetic data
        # Domain: x in [-1, 1]
        x_data = torch.rand(request.data_points, input_dim) * 2 - 1
        y_data = torch.sin(x_data[:, 0:1]) * torch.cos(x_data[:, 1:2])
        
        # Physics points
        x_phys = torch.rand(request.phys_points, input_dim) * 2 - 1
        
        # Set physics type
        physics_loss.physics_type = request.physics_type
        
        # Train
        results = trainer.train(
            x_data, y_data, x_phys,
            epochs=request.epochs,
            batch_size=request.batch_size
        )
        
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
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict_pinns(x: List[List[float]]):
    """Make predictions using PINN"""
    try:
        x_tensor = torch.tensor(x, dtype=torch.float32)
        predictions = trainer.predict(x_tensor)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'shape': predictions.shape
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/pinns_model.pth"):
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/pinns_model.pth"):
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
        raise HTTPException(status_code=500, detail=str(e))