from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from meta.model import MAML, MAMLModel, FewShotLearner, TaskGenerator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/meta", tags=["Meta-Learning"])

# Initialize models
input_dim = 64
hidden_dim = 256
output_dim = 1

model = MAMLModel(input_dim, hidden_dim, output_dim)
maml = MAML(model)
few_shot = FewShotLearner(maml)
task_generator = TaskGenerator()

class TrainRequest(BaseModel):
    epochs: int = 50
    tasks_per_epoch: int = 10
    k_shot: int = 5

class FewShotRequest(BaseModel):
    support_x: List[List[float]]
    support_y: List[float]
    query_x: List[List[float]]
    steps: int = 5

class FewShotClassifyRequest(BaseModel):
    support_set: Dict[str, List[List[float]]]
    query_x: List[List[float]]
    steps: int = 5

@router.post("/train")
async def train_maml(request: TrainRequest):
    """Train MAML model"""
    try:
        results = maml.meta_train(
            task_generator,
            request.epochs,
            request.tasks_per_epoch,
            request.k_shot
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/few-shot/predict")
async def few_shot_predict(request: FewShotRequest):
    """Few-shot prediction"""
    try:
        support_x = np.array(request.support_x)
        support_y = np.array(request.support_y)
        query_x = np.array(request.query_x)
        
        predictions = few_shot.few_shot_predict(
            support_x, support_y, query_x, request.steps
        )
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'steps': request.steps
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Few-shot prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/few-shot/classify")
async def few_shot_classify(request: FewShotClassifyRequest):
    """Few-shot classification"""
    try:
        support_set = {}
        for label, data in request.support_set.items():
            support_set[label] = np.array(data)
        
        query_x = np.array(request.query_x)
        
        predictions = few_shot.few_shot_classify(
            support_set, query_x, request.steps
        )
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'steps': request.steps
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Few-shot classification failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/task/sample")
async def sample_task(k_shot: int = 5):
    """Sample a task for meta-learning"""
    try:
        task = task_generator.sample_task(k_shot)
        
        return {
            'success': True,
            'data': {
                'support_x': task[0].tolist(),
                'support_y': task[1].tolist(),
                'query_x': task[2].tolist(),
                'query_y': task[3].tolist()
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Task sampling failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/task/few-shot")
async def sample_few_shot_task(k_shot: int = 5, num_classes: int = 2):
    """Sample a few-shot classification task"""
    try:
        task = task_generator.generate_few_shot_task(k_shot, num_classes)
        
        # Convert to serializable format
        support_set = {}
        for label, data in task['support_set'].items():
            support_set[label] = data.tolist()
        
        return {
            'success': True,
            'data': {
                'support_set': support_set,
                'query_x': task['query_x'].tolist(),
                'query_y': task['query_y'].tolist()
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Few-shot task sampling failed: {e}")
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
                'parameters': sum(p.numel() for p in model.parameters()),
                'device': str(maml.device),
                'total_tasks': len(task_generator.tasks)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/maml_model.pth"):
    """Save MAML model"""
    try:
        maml.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/maml_model.pth"):
    """Load MAML model"""
    try:
        maml.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))