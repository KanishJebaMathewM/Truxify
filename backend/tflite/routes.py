from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import numpy as np
import json
from datetime import datetime
import logging
from model_converter import TFLiteConverter, TFLiteInference, EdgeAIOptimizer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/tflite", tags=["TensorFlow Lite"])

# Initialize services
converter = TFLiteConverter()
inference = TFLiteInference()
optimizer = EdgeAIOptimizer()

class ConvertRequest(BaseModel):
    model_type: str = 'keras'  # keras or saved_model
    quantization: str = 'float16'
    name: str = 'model'
    input_shape: List[int] = [1, 224, 224, 3]

class PredictRequest(BaseModel):
    model_name: str
    input_data: List[List[float]]

class BatchPredictRequest(BaseModel):
    model_name: str
    input_batch: List[List[List[float]]]

@router.post("/convert")
async def convert_model(request: ConvertRequest):
    """Convert model to TFLite"""
    try:
        # Create a sample model
        import tensorflow as tf
        
        model = tf.keras.Sequential([
            tf.keras.layers.Conv2D(32, 3, activation='relu', input_shape=request.input_shape[1:]),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Conv2D(64, 3, activation='relu'),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Flatten(),
            tf.keras.layers.Dense(128, activation='relu'),
            tf.keras.layers.Dense(10, activation='softmax')
        ])
        
        if request.model_type == 'keras':
            result = converter.convert_to_tflite(
                model,
                tuple(request.input_shape),
                request.quantization,
                request.name
            )
        else:
            # Save model first
            saved_model_dir = "models/saved_model"
            model.save(saved_model_dir)
            result = converter.convert_to_tflite_from_saved_model(
                saved_model_dir,
                request.quantization,
                request.name
            )
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Conversion error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict_tflite(request: PredictRequest):
    """Run TFLite inference"""
    try:
        input_array = np.array(request.input_data, dtype=np.float32)
        result = inference.predict(request.model_name, input_array)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict-batch")
async def predict_batch_tflite(request: BatchPredictRequest):
    """Run batch TFLite inference"""
    try:
        input_batch = [np.array(data, dtype=np.float32) for data in request.input_batch]
        result = inference.predict_batch(request.model_name, input_batch)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Batch prediction error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize/quantize")
async def quantize_model(request: ConvertRequest):
    """Quantize model for edge deployment"""
    try:
        import tensorflow as tf
        
        model = tf.keras.Sequential([
            tf.keras.layers.Dense(128, activation='relu', input_shape=(784,)),
            tf.keras.layers.Dense(10, activation='softmax')
        ])
        
        quantized_model = optimizer.quantize_weights(model, request.quantization)
        
        return {
            'success': True,
            'data': {
                'quantization': request.quantization,
                'model_quantized': True,
                'timestamp': datetime.now().isoformat()
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Quantization error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize/analyze")
async def analyze_performance(request: ConvertRequest):
    """Analyze model performance on edge"""
    try:
        import tensorflow as tf
        
        model = tf.keras.Sequential([
            tf.keras.layers.Conv2D(32, 3, activation='relu', input_shape=request.input_shape[1:]),
            tf.keras.layers.MaxPooling2D(2),
            tf.keras.layers.Flatten(),
            tf.keras.layers.Dense(10, activation='softmax')
        ])
        
        result = optimizer.analyze_edge_performance(model, tuple(request.input_shape))
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Performance analysis error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/models")
async def list_models():
    """List available TFLite models"""
    try:
        import os
        model_dir = "models/tflite"
        models = []
        
        if os.path.exists(model_dir):
            for file in os.listdir(model_dir):
                if file.endswith('.tflite'):
                    model_path = os.path.join(model_dir, file)
                    size_mb = os.path.getsize(model_path) / (1024 * 1024)
                    models.append({
                        'name': file.replace('.tflite', ''),
                        'size_mb': size_mb,
                        'path': model_path
                    })
        
        return {
            'success': True,
            'data': {
                'models': models,
                'count': len(models),
                'timestamp': datetime.now().isoformat()
            }
        }
    except Exception as e:
        logger.error(f"List models error: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info/{model_name}")
async def get_model_info(model_name: str):
    """Get model information"""
    try:
        result = inference.get_model_info(model_name)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info error: {e}")
        raise HTTPException(status_code=500, detail=str(e))