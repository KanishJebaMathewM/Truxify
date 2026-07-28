from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from mtl.model import MultiTaskModel, MTLLoss, MultiTaskTrainer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/mtl", tags=["Multi-Task Learning"])

# Define tasks
tasks = {
    'eta': {'output_dim': 1, 'type': 'regression'},
    'price': {'output_dim': 1, 'type': 'regression'},
    'risk': {'output_dim': 2, 'type': 'classification'},
    'demand': {'output_dim': 1, 'type': 'regression'}
}

input_dim = 64
hidden_dim = 256

# Initialize model
model = MultiTaskModel(input_dim, tasks, hidden_dim)

# Define losses
task_losses = {
    'eta': torch.nn.MSELoss(),
    'price': torch.nn.MSELoss(),
    'risk': torch.nn.CrossEntropyLoss(),
    'demand': torch.nn.MSELoss()
}

mtl_loss = MTLLoss(task_losses)
trainer = MultiTaskTrainer(model, mtl_loss)

class TrainRequest(BaseModel):
    epochs: int = 50
    batch_size: int = 32
    data_size: int = 1000

@router.post("/train")
async def train_mtl(request: TrainRequest):
    """Train multi-task model"""
    try:
        # Generate synthetic data
        X_train = torch.randn(request.data_size, input_dim)
        y_train = {
            'eta': torch.randn(request.data_size, 1),
            'price': torch.randn(request.data_size, 1),
            'risk': torch.randint(0, 2, (request.data_size,)),
            'demand': torch.randn(request.data_size, 1)
        }
        
        X_val = torch.randn(200, input_dim)
        y_val = {
            'eta': torch.randn(200, 1),
            'price': torch.randn(200, 1),
            'risk': torch.randint(0, 2, (200,)),
            'demand': torch.randn(200, 1)
        }
        
        # Train
        results = trainer.train(
            X_train, y_train,
            epochs=request.epochs,
            batch_size=request.batch_size,
            val_data=X_val,
            val_targets=y_val
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict_mtl(data: List[List[float]]):
    """Make multi-task predictions"""
    try:
        X = torch.tensor(data, dtype=torch.float32)
        predictions = trainer.predict(X)
        
        result = {}
        for task_name, pred in predictions.items():
            result[task_name] = pred.cpu().numpy().tolist()
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict/task")
async def predict_single_task(data: List[List[float]], task_name: str):
    """Make prediction for single task"""
    try:
        X = torch.tensor(data, dtype=torch.float32)
        prediction = trainer.model.forward_single_task(X, task_name)
        
        return {
            'success': True,
            'data': {
                task_name: prediction.cpu().numpy().tolist()
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Single task prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'tasks': list(model.tasks.keys()),
                'task_config': model.tasks,
                'input_dim': input_dim,
                'hidden_dim': hidden_dim,
                'parameters': sum(p.numel() for p in model.parameters()),
                'trainable': sum(p.numel() for p in model.parameters() if p.requires_grad),
                'device': str(trainer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/mtl_model.pth"):
    """Save multi-task model"""
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
async def load_model(path: str = "models/mtl_model.pth"):
    """Load multi-task model"""
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