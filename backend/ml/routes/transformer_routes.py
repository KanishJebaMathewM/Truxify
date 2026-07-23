from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from transformers.model import (
    DemandForecastTransformer,
    TrafficForecastTransformer,
    PriceForecastTransformer,
    TransformerTrainer
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/transformer", tags=["Time Series Transformers"])

# Initialize models
demand_model = DemandForecastTransformer()
traffic_model = TrafficForecastTransformer()
price_model = PriceForecastTransformer()

demand_trainer = TransformerTrainer(demand_model)
traffic_trainer = TransformerTrainer(traffic_model)
price_trainer = TransformerTrainer(price_model)

class ForecastRequest(BaseModel):
    data: List[List[float]]
    horizon: int = 24

class TrainRequest(BaseModel):
    epochs: int = 50
    batch_size: int = 32

@router.post("/demand/forecast")
async def forecast_demand(request: ForecastRequest):
    """Forecast demand using transformer"""
    try:
        # Convert to tensor
        x = torch.tensor(request.data, dtype=torch.float32)
        if len(x.shape) == 2:
            x = x.unsqueeze(0)  # Add batch dimension
        
        # Predict
        predictions = demand_trainer.predict(x)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'horizon': request.horizon,
                'type': 'demand'
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Demand forecast failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/traffic/forecast")
async def forecast_traffic(request: ForecastRequest):
    """Forecast traffic using transformer"""
    try:
        x = torch.tensor(request.data, dtype=torch.float32)
        if len(x.shape) == 2:
            x = x.unsqueeze(0)
        
        predictions = traffic_trainer.predict(x)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'horizon': request.horizon,
                'type': 'traffic'
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Traffic forecast failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/price/forecast")
async def forecast_price(request: ForecastRequest):
    """Forecast price using transformer"""
    try:
        x = torch.tensor(request.data, dtype=torch.float32)
        if len(x.shape) == 2:
            x = x.unsqueeze(0)
        
        predictions = price_trainer.predict(x)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions.tolist(),
                'horizon': request.horizon,
                'type': 'price'
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Price forecast failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/demand/train")
async def train_demand(request: TrainRequest):
    """Train demand forecast transformer"""
    try:
        # Generate synthetic training data
        train_data = torch.randn(1000, demand_model.transformer.seq_len, demand_model.input_dim)
        train_labels = torch.randn(1000, demand_model.transformer.pred_len)
        val_data = torch.randn(200, demand_model.transformer.seq_len, demand_model.input_dim)
        val_labels = torch.randn(200, demand_model.transformer.pred_len)
        
        results = demand_trainer.train(
            train_data, train_labels,
            epochs=request.epochs,
            batch_size=request.batch_size,
            val_data=val_data,
            val_labels=val_labels
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/traffic/train")
async def train_traffic(request: TrainRequest):
    """Train traffic forecast transformer"""
    try:
        train_data = torch.randn(1000, traffic_model.transformer.seq_len, traffic_model.input_dim)
        train_labels = torch.randn(1000, traffic_model.transformer.pred_len)
        val_data = torch.randn(200, traffic_model.transformer.seq_len, traffic_model.input_dim)
        val_labels = torch.randn(200, traffic_model.transformer.pred_len)
        
        results = traffic_trainer.train(
            train_data, train_labels,
            epochs=request.epochs,
            batch_size=request.batch_size,
            val_data=val_data,
            val_labels=val_labels
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/price/train")
async def train_price(request: TrainRequest):
    """Train price forecast transformer"""
    try:
        train_data = torch.randn(1000, price_model.transformer.seq_len, price_model.input_dim)
        train_labels = torch.randn(1000, price_model.transformer.pred_len)
        val_data = torch.randn(200, price_model.transformer.seq_len, price_model.input_dim)
        val_labels = torch.randn(200, price_model.transformer.pred_len)
        
        results = price_trainer.train(
            train_data, train_labels,
            epochs=request.epochs,
            batch_size=request.batch_size,
            val_data=val_data,
            val_labels=val_labels
        )
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'demand': {
                    'input_dim': demand_model.input_dim,
                    'seq_len': demand_model.transformer.seq_len,
                    'pred_len': demand_model.transformer.pred_len,
                    'parameters': sum(p.numel() for p in demand_model.parameters())
                },
                'traffic': {
                    'input_dim': traffic_model.input_dim,
                    'seq_len': traffic_model.transformer.seq_len,
                    'pred_len': traffic_model.transformer.pred_len,
                    'parameters': sum(p.numel() for p in traffic_model.parameters())
                },
                'price': {
                    'input_dim': price_model.input_dim,
                    'seq_len': price_model.transformer.seq_len,
                    'pred_len': price_model.transformer.pred_len,
                    'parameters': sum(p.numel() for p in price_model.parameters())
                },
                'device': str(demand_trainer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))