import tensorflow as tf
import numpy as np
from typing import Dict, List, Tuple, Any, Optional
import json
import logging
from datetime import datetime
import os
import hashlib

logger = logging.getLogger(__name__)

class TFLiteConverter:
    """Convert models to TensorFlow Lite format"""
    
    def __init__(self, model_dir: str = "models/tflite"):
        self.model_dir = model_dir
        os.makedirs(model_dir, exist_ok=True)
        
        logger.info(f"✅ TFLite Converter initialized (model_dir: {model_dir})")
    
    def convert_to_tflite(
        self,
        model: tf.keras.Model,
        input_shape: Tuple[int, ...],
        quantization: str = 'float16',
        name: str = 'model'
    ) -> Dict:
        """Convert Keras model to TFLite"""
        try:
            # Create converter
            converter = tf.lite.TFLiteConverter.from_keras_model(model)
            
            # Set quantization
            if quantization == 'float16':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_types = [tf.float16]
            elif quantization == 'int8':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
                converter.inference_input_type = tf.int8
                converter.inference_output_type = tf.int8
                
                # Representative dataset for quantization
                def representative_dataset():
                    for _ in range(100):
                        yield [np.random.randn(1, *input_shape[1:]).astype(np.float32)]
                
                converter.representative_dataset = representative_dataset
            elif quantization == 'none':
                pass  # No quantization
            
            # Convert
            tflite_model = converter.convert()
            
            # Save model
            model_path = os.path.join(self.model_dir, f"{name}.tflite")
            with open(model_path, 'wb') as f:
                f.write(tflite_model)
            
            # Generate metadata
            metadata = {
                'name': name,
                'quantization': quantization,
                'input_shape': input_shape,
                'size': len(tflite_model),
                'size_mb': len(tflite_model) / (1024 * 1024),
                'converted_at': datetime.now().isoformat(),
                'hash': hashlib.md5(tflite_model).hexdigest()
            }
            
            # Save metadata
            meta_path = os.path.join(self.model_dir, f"{name}_metadata.json")
            with open(meta_path, 'w') as f:
                json.dump(metadata, f, indent=2)
            
            logger.info(f"✅ Model converted: {name} ({quantization}, {metadata['size_mb']:.2f} MB)")
            
            return {
                'success': True,
                'model_path': model_path,
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def convert_to_tflite_from_saved_model(
        self,
        saved_model_dir: str,
        quantization: str = 'float16',
        name: str = 'model'
    ) -> Dict:
        """Convert saved model to TFLite"""
        try:
            converter = tf.lite.TFLiteConverter.from_saved_model(saved_model_dir)
            
            # Apply quantization
            if quantization == 'float16':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_types = [tf.float16]
            elif quantization == 'int8':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
                converter.inference_input_type = tf.int8
                converter.inference_output_type = tf.int8
            
            tflite_model = converter.convert()
            
            # Save
            model_path = os.path.join(self.model_dir, f"{name}.tflite")
            with open(model_path, 'wb') as f:
                f.write(tflite_model)
            
            metadata = {
                'name': name,
                'quantization': quantization,
                'size': len(tflite_model),
                'size_mb': len(tflite_model) / (1024 * 1024),
                'converted_at': datetime.now().isoformat()
            }
            
            logger.info(f"✅ Model converted from saved model: {name}")
            
            return {
                'success': True,
                'model_path': model_path,
                'metadata': metadata
            }
            
        except Exception as e:
            logger.error(f"Conversion failed: {e}")
            return {'success': False, 'error': str(e)}

class TFLiteInference:
    """TensorFlow Lite inference engine"""
    
    def __init__(self, model_dir: str = "models/tflite"):
        self.model_dir = model_dir
        self.interpreter_cache = {}
        
        logger.info("✅ TFLite Inference initialized")
    
    def load_model(self, model_name: str) -> bool:
        """Load TFLite model"""
        try:
            model_path = os.path.join(self.model_dir, f"{model_name}.tflite")
            
            if not os.path.exists(model_path):
                logger.error(f"Model not found: {model_path}")
                return False
            
            # Load interpreter
            interpreter = tf.lite.Interpreter(model_path=model_path)
            interpreter.allocate_tensors()
            
            # Get input/output details
            input_details = interpreter.get_input_details()
            output_details = interpreter.get_output_details()
            
            self.interpreter_cache[model_name] = {
                'interpreter': interpreter,
                'input_details': input_details,
                'output_details': output_details
            }
            
            logger.info(f"✅ Model loaded: {model_name}")
            return True
            
        except Exception as e:
            logger.error(f"Model loading failed: {e}")
            return False
    
    def predict(
        self,
        model_name: str,
        input_data: np.ndarray
    ) -> Dict:
        """Run inference on edge device"""
        try:
            if model_name not in self.interpreter_cache:
                if not self.load_model(model_name):
                    return {'success': False, 'error': 'Model not loaded'}
            
            cache = self.interpreter_cache[model_name]
            interpreter = cache['interpreter']
            input_details = cache['input_details']
            output_details = cache['output_details']
            
            # Preprocess input
            input_shape = input_details[0]['shape']
            if input_data.shape != input_shape:
                input_data = np.resize(input_data, input_shape)
            
            # Set input
            interpreter.set_tensor(input_details[0]['index'], input_data.astype(np.float32))
            
            # Run inference
            start_time = datetime.now()
            interpreter.invoke()
            end_time = datetime.now()
            
            # Get output
            output_data = interpreter.get_tensor(output_details[0]['index'])
            
            inference_time = (end_time - start_time).total_seconds() * 1000  # ms
            
            return {
                'success': True,
                'output': output_data.tolist(),
                'inference_time_ms': inference_time,
                'model_name': model_name,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Inference failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def predict_batch(
        self,
        model_name: str,
        input_batch: List[np.ndarray]
    ) -> Dict:
        """Run batch inference"""
        try:
            results = []
            total_time = 0
            
            for input_data in input_batch:
                result = self.predict(model_name, input_data)
                if result['success']:
                    results.append(result['output'])
                    total_time += result['inference_time_ms']
            
            return {
                'success': True,
                'results': results,
                'batch_size': len(input_batch),
                'avg_time_ms': total_time / len(input_batch) if input_batch else 0,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Batch inference failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def get_model_info(self, model_name: str) -> Dict:
        """Get model information"""
        try:
            if model_name not in self.interpreter_cache:
                if not self.load_model(model_name):
                    return {'success': False, 'error': 'Model not loaded'}
            
            cache = self.interpreter_cache[model_name]
            
            return {
                'success': True,
                'model_name': model_name,
                'input_details': cache['input_details'],
                'output_details': cache['output_details'],
                'loaded': True
            }
            
        except Exception as e:
            logger.error(f"Model info failed: {e}")
            return {'success': False, 'error': str(e)}

class EdgeAIOptimizer:
    """Optimize models for edge deployment"""
    
    def __init__(self):
        logger.info("✅ Edge AI Optimizer initialized")
    
    def quantize_weights(
        self,
        model: tf.keras.Model,
        quantization_type: str = 'float16'
    ) -> tf.keras.Model:
        """Quantize model weights"""
        try:
            # Apply quantization
            converter = tf.lite.TFLiteConverter.from_keras_model(model)
            
            if quantization_type == 'float16':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_types = [tf.float16]
            elif quantization_type == 'int8':
                converter.optimizations = [tf.lite.Optimize.DEFAULT]
                converter.target_spec.supported_ops = [tf.lite.OpsSet.TFLITE_BUILTINS_INT8]
            
            # Convert
            tflite_model = converter.convert()
            
            # Save quantized model
            quantized_path = "models/quantized_model.tflite"
            with open(quantized_path, 'wb') as f:
                f.write(tflite_model)
            
            logger.info(f"✅ Model quantized: {quantization_type}")
            
            return model
            
        except Exception as e:
            logger.error(f"Quantization failed: {e}")
            return model
    
    def prune_model(
        self,
        model: tf.keras.Model,
        sparsity: float = 0.5
    ) -> tf.keras.Model:
        """Prune model for edge deployment"""
        try:
            import tensorflow_model_optimization as tfmot
            
            # Apply pruning
            pruning_schedule = tfmot.sparsity.keras.ConstantSparsity(
                target_sparsity=sparsity,
                begin_step=0,
                end_step=1000,
                frequency=100
            )
            
            pruned_model = tfmot.sparsity.keras.prune_low_magnitude(
                model,
                pruning_schedule=pruning_schedule
            )
            
            logger.info(f"✅ Model pruned: {sparsity*100}% sparsity")
            
            return pruned_model
            
        except Exception as e:
            logger.error(f"Pruning failed: {e}")
            return model
    
    def analyze_edge_performance(
        self,
        model: tf.keras.Model,
        input_shape: Tuple[int, ...]
    ) -> Dict:
        """Analyze model performance on edge"""
        try:
            # Convert to TFLite
            converter = tf.lite.TFLiteConverter.from_keras_model(model)
            tflite_model = converter.convert()
            
            # Measure size
            size_mb = len(tflite_model) / (1024 * 1024)
            
            # Measure inference time (simulated)
            import time
            interpreter = tf.lite.Interpreter(model_content=tflite_model)
            interpreter.allocate_tensors()
            
            input_details = interpreter.get_input_details()
            output_details = interpreter.get_output_details()
            
            # Warmup
            for _ in range(10):
                interpreter.set_tensor(
                    input_details[0]['index'],
                    np.random.randn(1, *input_shape[1:]).astype(np.float32)
                )
                interpreter.invoke()
            
            # Measure
            times = []
            for _ in range(100):
                start = time.time()
                interpreter.set_tensor(
                    input_details[0]['index'],
                    np.random.randn(1, *input_shape[1:]).astype(np.float32)
                )
                interpreter.invoke()
                times.append((time.time() - start) * 1000)
            
            avg_time = np.mean(times)
            std_time = np.std(times)
            
            return {
                'success': True,
                'model_size_mb': size_mb,
                'avg_inference_ms': avg_time,
                'std_inference_ms': std_time,
                'min_inference_ms': np.min(times),
                'max_inference_ms': np.max(times),
                'device': 'simulated_edge',
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Performance analysis failed: {e}")
            return {'success': False, 'error': str(e)}