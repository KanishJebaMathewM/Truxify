from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import numpy as np
import json
from datetime import datetime
import logging
from fhe_model import FHEService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/fhe-ai", tags=["FHE for AI"])

# Initialize FHE service
fhe_service = FHEService()

class ModelArchitecture(BaseModel):
    layers: List[Dict[str, Any]]

class TrainRequest(BaseModel):
    data: List[List[float]]
    labels: List[int]
    epochs: int = 10

class PredictRequest(BaseModel):
    data: List[List[float]]

@router.post("/model/create")
async def create_model(architecture: ModelArchitecture):
    """Create encrypted model"""
    try:
        result = fhe_service.create_model(architecture.layers)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model creation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/model/train")
async def train_model(request: TrainRequest):
    """Train model on encrypted data"""
    try:
        X = np.array(request.data)
        y = np.array(request.labels)
        
        result = fhe_service.train(X, y, request.epochs)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/model/predict")
async def predict(request: PredictRequest):
    """Make predictions using FHE"""
    try:
        X = np.array(request.data)
        result = fhe_service.predict(X)
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/model/encrypt")
async def encrypt_model():
    """Encrypt model weights"""
    try:
        result = fhe_service.encrypt_model_weights()
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Encryption failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/aggregate")
async def secure_aggregation(encrypted_updates: List[str]):
    """Secure aggregation of encrypted updates"""
    try:
        # In production: deserialize encrypted updates
        updates = []
        for update in encrypted_updates:
            # Placeholder
            updates.append(None)
        
        result = fhe_service.secure_aggregation(updates)
        return {
            'success': True,
            'data': {'aggregated': True},
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Aggregation failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_fhe_stats():
    """Get FHE-AI statistics"""
    try:
        stats = fhe_service.get_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))