import asyncio
import logging
from datetime import datetime
from functools import wraps
from threading import RLock
from typing import Literal, Optional

import torch
from fastapi import APIRouter, File, HTTPException, Query, UploadFile
from foundation.checkpoint_generation import load_bundle, save_bundle
from foundation.data import LogisticsDataProcessor, LogisticsDatasetGenerator
from foundation.finetuning import FinetuningAdmissionError
from foundation.model import (
    FoundationModelConfig,
    FoundationModelTrainer,
    LogisticsFoundationModel,
)
from pydantic import BaseModel, Field
from routes.foundation_validation import (
    UploadTooLarge,
    read_training_json,
    safe_model_path,
)

_foundation_state_lock = RLock()


def _with_foundation_state(function):
    @wraps(function)
    def locked(*args, **kwargs):
        with _foundation_state_lock:
            return function(*args, **kwargs)
    return locked


logger = logging.getLogger(__name__)
router = APIRouter(prefix="/foundation", tags=["Foundation Model"])

# Initialize model and config
config = FoundationModelConfig()
model = LogisticsFoundationModel(
    vocab_size=config.vocab_size,
    d_model=config.d_model,
    num_heads=config.num_heads,
    num_layers=config.num_layers,
    d_ff=config.d_ff,
    max_len=config.max_len,
    dropout=config.dropout
)
trainer = FoundationModelTrainer(model, config)
processor = LogisticsDataProcessor()

class GenerateDataRequest(BaseModel):
    num_samples: int = Field(default=1000, ge=1, le=10000)

class TrainRequest(BaseModel):
    epochs: Optional[int] = None
    batch_size: Optional[int] = None
    learning_rate: Optional[float] = None


async def _read_training_data(file: UploadFile):
    try:
        return await read_training_json(file)
    except UploadTooLarge as exc:
        raise HTTPException(status_code=413, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _validated_model_path(path: str) -> str:
    try:
        return safe_model_path(path)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

@router.post("/data/generate")
@_with_foundation_state
def generate_data(request: GenerateDataRequest):
    """Generate synthetic logistics data"""
    try:
        samples = LogisticsDatasetGenerator.generate_samples(request.num_samples)
        LogisticsDatasetGenerator.save_samples(samples)
        
        return {
            'success': True,
            'data': {
                'num_samples': len(samples),
                'samples_preview': samples[:5]
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Data generation failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@_with_foundation_state
def _native_prepare_data(data):
    try:
        
        # Prepare pretraining data
        pretrain_data = processor.create_pretraining_data(data)
        
        # Prepare finetuning data
        finetune_data = processor.create_finetuning_data(data)
        
        return {
            'success': True,
            'data': {
                'pretrain_samples': len(pretrain_data),
                'finetune_samples': len(finetune_data),
                'vocab_size': processor.get_vocab_size(),
                'pretrain_preview': pretrain_data[:3],
                'finetune_preview': finetune_data[:3]
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Data preparation failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/data/prepare")
async def prepare_data(file: UploadFile = File(...)):
    """Prepare data for training"""
    data = await _read_training_data(file)
    return await asyncio.to_thread(_native_prepare_data, data)

@_with_foundation_state
def _native_pretrain_model(data):
    try:
        # Prepare data
        train_data = processor.create_pretraining_data(data[:8000])
        val_data = processor.create_pretraining_data(data[8000:])
        
        # Train
        from foundation.pretraining import MaskedTokenTrainer
        results = MaskedTokenTrainer(model, config).train(train_data, val_data)
        
        return {
            'success': True,
            'data': {
                'final_train_loss': results['final_train_loss'],
                'final_val_loss': results['final_val_loss'],
                'train_losses': results['train_losses'],
                'supervised_tokens_per_epoch': results['supervised_tokens_per_epoch'],
                'val_losses': results['val_losses']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Pretraining failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/pretrain")
async def pretrain_model(file: Optional[UploadFile] = None):
    """Pre-train foundation model"""
    data = await _read_training_data(file) if file else LogisticsDatasetGenerator.generate_samples(10000)
    return await asyncio.to_thread(_native_pretrain_model, data)

@_with_foundation_state
def _native_finetune_model(data, task, epochs):
    try:
        # Prepare data
        train_data = processor.create_finetuning_data(data[:800], task)
        val_data = processor.create_finetuning_data(data[800:], task)
        
        # Task and epoch selection belong to this invocation, not shared config.
        results = trainer.train(train_data, val_data, task=task, epochs=epochs)
        
        return {
            'success': True,
            'data': {
                'task': task,
                'final_train_loss': results['final_train_loss'],
                'final_val_loss': results['final_val_loss']
            },
            'timestamp': datetime.now().isoformat()
        }
    except FinetuningAdmissionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as e:
        logger.error(f"Finetuning failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/finetune")
async def finetune_model(
    task: Literal['classification', 'regression'] = 'classification',
    epochs: int = Query(5, ge=1, le=100),
    file: Optional[UploadFile] = None
):
    """Fine-tune foundation model for specific task"""
    data = await _read_training_data(file) if file else LogisticsDatasetGenerator.generate_samples(1000)
    return await asyncio.to_thread(_native_finetune_model, data, task, epochs)

@router.post("/predict")
@_with_foundation_state
def predict(
    text: str = Query(..., min_length=1, max_length=10000),
    task: Literal['classification', 'regression'] = 'classification',
):
    """Make prediction using foundation model"""
    try:
        # Tokenize input
        tokens = processor.prepare_sequence(text)
        
        # Pad to max length
        if len(tokens) < config.max_len:
            tokens = tokens + [0] * (config.max_len - len(tokens))
        else:
            tokens = tokens[:config.max_len]
        
        # Convert to tensor
        input_ids = torch.tensor([tokens], dtype=torch.long)
        
        # Predict
        trainer.model.eval()
        with torch.no_grad():
            outputs = trainer.model(input_ids, task=task)
            logits = outputs['output']
            
            if task == 'classification':
                prediction = torch.softmax(logits, dim=-1).cpu().numpy()
                result = {
                    'class': int(prediction.argmax()),
                    'probabilities': prediction.tolist()[0]
                }
            elif task == 'regression':
                prediction = logits.cpu().numpy()
                result = {'value': float(prediction[0][0])}
            else:
                result = {'hidden': outputs['hidden'].cpu().numpy().tolist()}
        
        return {
            'success': True,
            'data': result,
            'task': task,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/model-info")
@_with_foundation_state
def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'vocab_size': config.vocab_size,
                'd_model': config.d_model,
                'num_heads': config.num_heads,
                'num_layers': config.num_layers,
                'd_ff': config.d_ff,
                'max_len': config.max_len,
                'parameters': sum(p.numel() for p in trainer.model.parameters()),
                'trainable': sum(p.numel() for p in trainer.model.parameters() if p.requires_grad),
                'device': str(trainer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/save")
@_with_foundation_state
def save_model(path: str = "models/foundation_model.pth"):
    """Save foundation model"""
    path = _validated_model_path(path)
    try:
        artifact = save_bundle(trainer, processor, path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'artifact': artifact,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/load")
@_with_foundation_state
def load_model(path: str = "models/foundation_model.pth"):
    """Load foundation model"""
    global trainer, processor, model, config
    path = _validated_model_path(path)
    try:
        candidate_trainer, candidate_processor, artifact = load_bundle(trainer, processor, path)
        trainer, processor = candidate_trainer, candidate_processor
        model, config = trainer.model, trainer.config
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'artifact': artifact,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")
