from fastapi import APIRouter, HTTPException, UploadFile, File, Query
from pydantic import BaseModel, Field
from typing import Optional, Literal
import torch
from datetime import datetime
import logging

from foundation.model import LogisticsFoundationModel, FoundationModelConfig, FoundationModelTrainer
from foundation.data import LogisticsDataProcessor, LogisticsDatasetGenerator
from routes.foundation_validation import UploadTooLarge, read_training_json, safe_model_path

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

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/data/prepare")
async def prepare_data(file: UploadFile = File(...)):
    """Prepare data for training"""
    data = await _read_training_data(file)
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

@router.post("/pretrain")
async def pretrain_model(file: Optional[UploadFile] = None):
    """Pre-train foundation model"""
    data = await _read_training_data(file) if file else LogisticsDatasetGenerator.generate_samples(10000)
    try:
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

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/finetune")
async def finetune_model(
    task: Literal['classification', 'regression'] = 'classification',
    epochs: int = Query(5, ge=1, le=100),
    file: Optional[UploadFile] = None
):
    """Fine-tune foundation model for specific task"""
    data = await _read_training_data(file) if file else LogisticsDatasetGenerator.generate_samples(1000)
    try:
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

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/predict")
async def predict(
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

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/save")
async def save_model(path: str = "models/foundation_model.pth"):
    """Save foundation model"""
    path = _validated_model_path(path)
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

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/load")
async def load_model(path: str = "models/foundation_model.pth"):
    """Load foundation model"""
    path = _validated_model_path(path)
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

        raise HTTPException(status_code=500, detail="Internal server error")
