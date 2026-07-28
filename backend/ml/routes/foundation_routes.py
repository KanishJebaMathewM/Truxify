from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import json
from datetime import datetime
import logging

from foundation.model import LogisticsFoundationModel, FoundationModelConfig, FoundationModelTrainer
from foundation.data import LogisticsDataProcessor, LogisticsDatasetGenerator

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
    num_samples: int = 1000

class TrainRequest(BaseModel):
    epochs: Optional[int] = None
    batch_size: Optional[int] = None
    learning_rate: Optional[float] = None

@router.post("/data/generate")
async def generate_data(request: GenerateDataRequest):
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/data/prepare")
async def prepare_data(file: UploadFile = File(...)):
    """Prepare data for training"""
    try:
        content = await file.read()
        data = json.loads(content)
        
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
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/pretrain")
async def pretrain_model(file: Optional[UploadFile] = None):
    """Pre-train foundation model"""
    try:
        # Load data
        if file:
            content = await file.read()
            data = json.loads(content)
        else:
            # Generate synthetic data
            data = LogisticsDatasetGenerator.generate_samples(10000)
        
        # Prepare data
        train_data = processor.create_pretraining_data(data[:8000])
        val_data = processor.create_pretraining_data(data[8000:])
        
        # Train
        results = trainer.train(train_data, val_data)
        
        return {
            'success': True,
            'data': {
                'final_train_loss': results['final_train_loss'],
                'final_val_loss': results['final_val_loss'],
                'train_losses': results['train_losses'],
                'val_losses': results['val_losses']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Pretraining failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/finetune")
async def finetune_model(
    task: str = 'classification',
    epochs: int = 5,
    file: Optional[UploadFile] = None
):
    """Fine-tune foundation model for specific task"""
    try:
        # Load data
        if file:
            content = await file.read()
            data = json.loads(content)
        else:
            data = LogisticsDatasetGenerator.generate_samples(1000)
        
        # Prepare data
        train_data = processor.create_finetuning_data(data[:800], task)
        val_data = processor.create_finetuning_data(data[800:], task)
        
        # Update config
        config.epochs = epochs
        trainer.config = config
        
        # Train
        results = trainer.train(train_data, val_data)
        
        return {
            'success': True,
            'data': {
                'task': task,
                'final_train_loss': results['final_train_loss'],
                'final_val_loss': results['final_val_loss']
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Finetuning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict(text: str, task: str = 'classification'):
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
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
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
async def save_model(path: str = "models/foundation_model.pth"):
    """Save foundation model"""
    try:
        trainer.save(path)
        processor.save_vocab()
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/foundation_model.pth"):
    """Load foundation model"""
    try:
        trainer.load(path)
        processor.load_vocab()
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))