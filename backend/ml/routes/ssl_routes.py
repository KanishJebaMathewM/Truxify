from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from ssl.model import SimCLR, MoCo, MaskedAutoencoder, SSLPreTrainer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/ssl", tags=["Self-Supervised Learning"])

# Initialize models
input_dim = 64
hidden_dim = 256
projection_dim = 128

simclr_model = SimCLR(input_dim, hidden_dim, projection_dim)
moco_model = MoCo(input_dim, hidden_dim, projection_dim)
mae_model = MaskedAutoencoder(input_dim, hidden_dim)

simclr_trainer = SSLPreTrainer(simclr_model)
moco_trainer = SSLPreTrainer(moco_model)
mae_trainer = SSLPreTrainer(mae_model)

class PretrainRequest(BaseModel):
    method: str = 'simclr'  # simclr, moco, mae
    epochs: int = 50
    batch_size: int = 32
    data_size: int = 1000

@router.post("/pretrain")
async def pretrain_model(request: PretrainRequest):
    """Pre-train model using self-supervised learning"""
    try:
        # Generate synthetic data
        data = torch.randn(request.data_size, 50, input_dim)
        
        # Choose method
        if request.method == 'simclr':
            results = simclr_trainer.pretrain_simclr(
                data, request.epochs, request.batch_size
            )
            model_name = 'SimCLR'
        elif request.method == 'moco':
            results = moco_trainer.pretrain_moco(
                data, request.epochs, request.batch_size
            )
            model_name = 'MoCo'
        elif request.method == 'mae':
            results = mae_trainer.pretrain_mae(
                data, request.epochs, request.batch_size
            )
            model_name = 'MAE'
        else:
            return {
                'success': False,
                'error': 'Invalid method. Choose simclr, moco, or mae'
            }
        
        return {
            'success': True,
            'data': {
                'method': request.method,
                'model': model_name,
                'results': results,
                'epochs': request.epochs
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Pre-training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pretrain/simclr")
async def pretrain_simclr(request: PretrainRequest):
    """Pre-train using SimCLR"""
    try:
        data = torch.randn(request.data_size, 50, input_dim)
        results = simclr_trainer.pretrain_simclr(data, request.epochs, request.batch_size)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"SimCLR pre-training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pretrain/moco")
async def pretrain_moco(request: PretrainRequest):
    """Pre-train using MoCo"""
    try:
        data = torch.randn(request.data_size, 50, input_dim)
        results = moco_trainer.pretrain_moco(data, request.epochs, request.batch_size)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"MoCo pre-training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pretrain/mae")
async def pretrain_mae(request: PretrainRequest):
    """Pre-train using Masked Autoencoder"""
    try:
        data = torch.randn(request.data_size, 50, input_dim)
        results = mae_trainer.pretrain_mae(data, request.epochs, request.batch_size)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"MAE pre-training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'simclr': {
                    'input_dim': input_dim,
                    'hidden_dim': hidden_dim,
                    'projection_dim': projection_dim,
                    'parameters': sum(p.numel() for p in simclr_model.parameters())
                },
                'moco': {
                    'input_dim': input_dim,
                    'hidden_dim': hidden_dim,
                    'projection_dim': projection_dim,
                    'queue_size': moco_model.queue_size,
                    'parameters': sum(p.numel() for p in moco_model.parameters())
                },
                'mae': {
                    'input_dim': input_dim,
                    'hidden_dim': hidden_dim,
                    'mask_ratio': mae_model.mask_ratio,
                    'parameters': sum(p.numel() for p in mae_model.parameters())
                },
                'device': str(simclr_trainer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(model_type: str = 'simclr', path: str = "models/ssl_model.pth"):
    """Save pre-trained model"""
    try:
        if model_type == 'simclr':
            simclr_trainer.save(path)
        elif model_type == 'moco':
            moco_trainer.save(path)
        elif model_type == 'mae':
            mae_trainer.save(path)
        else:
            return {
                'success': False,
                'error': 'Invalid model type'
            }
        
        return {
            'success': True,
            'message': f'{model_type} model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(model_type: str = 'simclr', path: str = "models/ssl_model.pth"):
    """Load pre-trained model"""
    try:
        if model_type == 'simclr':
            simclr_trainer.load(path)
        elif model_type == 'moco':
            moco_trainer.load(path)
        elif model_type == 'mae':
            mae_trainer.load(path)
        else:
            return {
                'success': False,
                'error': 'Invalid model type'
            }
        
        return {
            'success': True,
            'message': f'{model_type} model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))