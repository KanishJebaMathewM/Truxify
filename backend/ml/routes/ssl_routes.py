import logging
from datetime import datetime
from typing import Literal

import torch
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from self_supervised.model import MaskedAutoencoder, MoCo, SimCLR, SSLPreTrainer
from self_supervised.training_transition import SSLAdmissionError, counts

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
    method: Literal['simclr', 'moco', 'mae'] = 'simclr'
    epochs: int = Field(default=50, strict=True, ge=1, le=100)
    batch_size: int = Field(default=32, strict=True, ge=1, le=8192)
    data_size: int = Field(default=1000, strict=True, ge=1, le=10000)


def _run_pretraining(request, method):
    """Admit selected observation geometry/work before native allocation."""
    selected = {'simclr': simclr_trainer, 'moco': moco_trainer, 'mae': mae_trainer}[method]
    width = selected.model.input_dim * (50 if method == 'mae' else 1)
    try:
        counts(request.data_size, request.epochs, request.batch_size, width, method,
               getattr(selected.model, 'queue_size', 0))
        shape = ((request.data_size, 50, selected.model.input_dim) if method == 'mae'
                 else (request.data_size, selected.model.input_dim))
        parameter = next(selected.model.parameters())
        data = torch.randn(shape, device=parameter.device, dtype=parameter.dtype)
        return getattr(selected, 'pretrain_' + method)(data, request.epochs, request.batch_size)
    except SSLAdmissionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error('Native SSL pretraining failed: %s', exc)
        raise HTTPException(status_code=500, detail='Internal server error') from exc


@router.post('/pretrain')
async def pretrain_model(request: PretrainRequest):
    results = _run_pretraining(request, request.method)
    return {
        'success': True,
        'data': {'method': request.method,
                 'model': {'simclr': 'SimCLR', 'moco': 'MoCo', 'mae': 'MAE'}[request.method],
                 'results': results, 'epochs': request.epochs},
        'timestamp': datetime.now().isoformat(),
    }


def _method_response(request, method):
    return {'success': True, 'data': _run_pretraining(request, method),
            'timestamp': datetime.now().isoformat()}


@router.post('/pretrain/simclr')
async def pretrain_simclr(request: PretrainRequest):
    return _method_response(request, 'simclr')


@router.post('/pretrain/moco')
async def pretrain_moco(request: PretrainRequest):
    return _method_response(request, 'moco')


@router.post('/pretrain/mae')
async def pretrain_mae(request: PretrainRequest):
    return _method_response(request, 'mae')

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")