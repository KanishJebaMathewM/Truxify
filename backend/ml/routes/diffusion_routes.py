from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from diffusion.model import DiffusionRouteModel, DiffusionRouteGenerator
from diffusion.trainer import DiffusionTrainer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/diffusion", tags=["Diffusion Models"])

# Initialize model
input_dim = 64
hidden_dim = 256
num_timesteps = 1000

model = DiffusionRouteModel(
    input_dim=input_dim,
    hidden_dim=hidden_dim,
    num_timesteps=num_timesteps
)

generator = DiffusionRouteGenerator(model)
trainer = DiffusionTrainer(model)

class GenerateRequest(BaseModel):
    batch_size: int = 1
    route_length: int = 50
    condition: Optional[List[List[float]]] = None

class TrainRequest(BaseModel):
    epochs: int = 100
    batch_size: int = 32
    learning_rate: float = 1e-4

@router.post("/generate")
async def generate_routes(request: GenerateRequest):
    """Generate routes using diffusion model"""
    try:
        condition = None
        if request.condition:
            condition = torch.tensor(request.condition)
        
        routes = generator.sample(
            request.batch_size,
            request.route_length,
            condition
        )
        
        return {
            'success': True,
            'data': {
                'routes': routes.cpu().numpy().tolist(),
                'shape': routes.shape,
                'num_routes': request.batch_size
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Route generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate-route")
async def generate_route(
    start: List[float],
    end: List[float],
    condition: Optional[List[List[float]]] = None
):
    """Generate optimal route between points"""
    try:
        start_tensor = torch.tensor(start).unsqueeze(0)
        end_tensor = torch.tensor(end).unsqueeze(0)
        cond_tensor = torch.tensor(condition) if condition else None
        
        route = generator.generate_route(start_tensor, end_tensor, cond_tensor)
        
        return {
            'success': True,
            'data': {
                'route': route.cpu().numpy().tolist(),
                'start': start,
                'end': end
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Route generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/conditional")
async def conditional_generate(request: GenerateRequest):
    """Generate routes with conditions"""
    try:
        if not request.condition:
            raise HTTPException(status_code=400, detail="Condition required")
        
        condition = torch.tensor(request.condition)
        routes = generator.conditional_generate(condition)
        
        return {
            'success': True,
            'data': {
                'routes': routes.cpu().numpy().tolist(),
                'condition': request.condition
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Conditional generation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def train_model(request: TrainRequest):
    """Train diffusion model"""
    try:
        # Generate synthetic training data
        train_data = torch.randn(1000, 50, input_dim)
        val_data = torch.randn(200, 50, input_dim)
        
        trainer.batch_size = request.batch_size
        trainer.optimizer.param_groups[0]['lr'] = request.learning_rate
        
        results = trainer.train(train_data, request.epochs, val_data)
        
        return {
            'success': True,
            'data': {
                'final_train_loss': results['final_train_loss'],
                'final_val_loss': results['final_val_loss'],
                'epochs': request.epochs
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/diffusion_route.pth"):
    """Save diffusion model"""
    try:
        generator.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/diffusion_route.pth"):
    """Load diffusion model"""
    try:
        generator.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
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
                'num_timesteps': num_timesteps,
                'parameters': sum(p.numel() for p in model.parameters()),
                'trainable': sum(p.numel() for p in model.parameters() if p.requires_grad),
                'device': str(generator.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))