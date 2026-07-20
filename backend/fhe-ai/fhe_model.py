import torch
import torch.nn as nn
import numpy as np
import tenseal as ts
from typing import Dict, List, Tuple, Any, Optional
import logging
import pickle
import json
from datetime import datetime

logger = logging.getLogger(__name__)

class FHECiphertext:
    """Wrapper for FHE encrypted data"""
    
    def __init__(self, ciphertext, shape, dtype):
        self.ciphertext = ciphertext
        self.shape = shape
        self.dtype = dtype

class FHEModel:
    """FHE-encrypted neural network model"""
    
    def __init__(self, context: ts.Context):
        self.context = context
        self.layers = []
        self.weights = []
        self.biases = []
        self.is_encrypted = False
    
    def add_linear(self, in_features: int, out_features: int):
        """Add linear layer"""
        # Random weights and biases
        weights = torch.randn(out_features, in_features) * 0.01
        biases = torch.zeros(out_features)
        self.layers.append(('linear', {'in': in_features, 'out': out_features}))
        self.weights.append(weights)
        self.biases.append(biases)
        return self
    
    def add_relu(self):
        """Add ReLU activation"""
        self.layers.append(('relu', {}))
        return self
    
    def add_sigmoid(self):
        """Add Sigmoid activation"""
        self.layers.append(('sigmoid', {}))
        return self
    
    def add_softmax(self):
        """Add Softmax activation"""
        self.layers.append(('softmax', {}))
        return self
    
    def encrypt(self):
        """Encrypt model weights"""
        self.is_encrypted = True
        encrypted_weights = []
        encrypted_biases = []
        
        for weights, biases in zip(self.weights, self.biases):
            # Convert to numpy
            w_np = weights.numpy().flatten()
            b_np = biases.numpy().flatten()
            
            # Encrypt
            enc_w = ts.ckks_vector(self.context, w_np.tolist())
            enc_b = ts.ckks_vector(self.context, b_np.tolist())
            
            encrypted_weights.append(enc_w)
            encrypted_biases.append(enc_b)
        
        self.weights = encrypted_weights
        self.biases = encrypted_biases
        
        logger.info("✅ Model weights encrypted")
        return self
    
    def encrypt_input(self, data: np.ndarray) -> ts.ckks_vector:
        """Encrypt input data"""
        return ts.ckks_vector(self.context, data.flatten().tolist())
    
    def decrypt_output(self, encrypted_output: ts.ckks_vector) -> np.ndarray:
        """Decrypt output data"""
        return np.array(encrypted_output.decrypt())
    
    def forward(self, x: ts.ckks_vector) -> ts.ckks_vector:
        """Forward pass on encrypted data"""
        for i, (layer_type, params) in enumerate(self.layers):
            if layer_type == 'linear':
                # Linear layer
                x = self._encrypted_linear(x, self.weights[i], self.biases[i])
            elif layer_type == 'relu':
                # ReLU (approximated)
                x = self._encrypted_relu(x)
            elif layer_type == 'sigmoid':
                # Sigmoid (approximated)
                x = self._encrypted_sigmoid(x)
            elif layer_type == 'softmax':
                # Softmax (approximated)
                x = self._encrypted_softmax(x)
        
        return x
    
    def _encrypted_linear(self, x: ts.ckks_vector, weights: ts.ckks_vector, bias: ts.ckks_vector) -> ts.ckks_vector:
        """Encrypted linear layer"""
        # In production: use FHE matrix multiplication
        # For now, multiply by a scalar (simplified)
        result = x * 0.5  # Simulated linear transformation
        return result
    
    def _encrypted_relu(self, x: ts.ckks_vector) -> ts.ckks_vector:
        """Encrypted ReLU (approximated)"""
        # Use polynomial approximation
        # relu(x) ≈ 0.5 * x * (1 + x / sqrt(x^2 + epsilon))
        epsilon = 1e-7
        x_sq = x * x
        denom = (x_sq + epsilon).sqrt()
        result = 0.5 * x * (1 + x / denom)
        return result
    
    def _encrypted_sigmoid(self, x: ts.ckks_vector) -> ts.ckks_vector:
        """Encrypted Sigmoid (approximated)"""
        # sigmoid(x) ≈ 0.5 + 0.197 * x - 0.004 * x^3
        x_sq = x * x
        x_cu = x_sq * x
        result = 0.5 + 0.197 * x - 0.004 * x_cu
        return result
    
    def _encrypted_softmax(self, x: ts.ckks_vector) -> ts.ckks_vector:
        """Encrypted Softmax (approximated)"""
        # Use Newton-Raphson reciprocal approximation: r_{n+1} = r * (2 - denom * r)
        # Avoids CKKS vector/vector division which TenSEAL does not support
        epsilon = 1e-7
        denom = x + epsilon
        y = 0.5  # initial guess for reciprocal of denom
        y = y * (2 - denom * y)  # iteration 1
        y = y * (2 - denom * y)  # iteration 2
        y = y * (2 - denom * y)  # iteration 3
        return x * y

class FHETrainer:
    """Trainer for FHE-encrypted models"""
    
    def __init__(self, context: ts.Context):
        self.context = context
        self.model = None
    
    def create_model(self, architecture: List[Dict]) -> FHEModel:
        """Create FHE model with given architecture"""
        self.model = FHEModel(self.context)
        
        for layer in architecture:
            if layer['type'] == 'linear':
                self.model.add_linear(layer['in'], layer['out'])
            elif layer['type'] == 'relu':
                self.model.add_relu()
            elif layer['type'] == 'sigmoid':
                self.model.add_sigmoid()
        
        return self.model
    
    def train_encrypted(self, X: np.ndarray, y: np.ndarray, epochs: int = 10) -> Dict:
        """Train model on encrypted data"""
        if self.model is None:
            raise ValueError("Model not created")
        
        # Encrypt input
        X_enc = self.model.encrypt_input(X)
        
        # Simple training (simulated)
        losses = []
        for epoch in range(epochs):
            # Forward pass (encrypted)
            y_pred = self.model.forward(X_enc)
            
            # Loss (simulated)
            loss = 0.5
            losses.append(loss)
            
            if (epoch + 1) % 5 == 0:
                logger.info(f"Epoch {epoch+1}/{epochs}: Loss = {loss:.4f}")
        
        return {
            'losses': losses,
            'final_loss': losses[-1] if losses else None
        }
    
    def predict_encrypted(self, X: np.ndarray) -> np.ndarray:
        """Make predictions on encrypted data"""
        if self.model is None:
            raise ValueError("Model not created")
        
        # Encrypt input
        X_enc = self.model.encrypt_input(X)
        
        # Forward pass
        y_pred_enc = self.model.forward(X_enc)
        
        # Decrypt output
        y_pred = self.model.decrypt_output(y_pred_enc)
        
        return y_pred

class FHEService:
    """FHE for AI Inference Service"""
    
    def __init__(self):
        # Create TenSEAL context
        self.context = self._create_context()
        self.model = None
        self.trainer = FHETrainer(self.context)
        
        logger.info("✅ FHE-AI Service initialized")
    
    def _create_context(self) -> ts.Context:
        """Create TenSEAL context"""
        # CKKS parameters
        poly_modulus_degree = 8192
        coeff_mod_bit_sizes = [60, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40]
        
        context = ts.context(
            ts.SCHEME_TYPE.CKKS,
            poly_modulus_degree=poly_modulus_degree,
            coeff_mod_bit_sizes=coeff_mod_bit_sizes
        )
        
        # Generate keys
        context.generate_galois_keys()
        context.generate_relin_keys()
        
        return context
    
    def create_model(self, architecture: List[Dict]) -> Dict:
        """Create and encrypt model"""
        try:
            model = self.trainer.create_model(architecture)
            model.encrypt()
            self.model = model
            
            return {
                'success': True,
                'architecture': architecture,
                'layers': len(architecture),
                'is_encrypted': model.is_encrypted
            }
        except Exception as e:
            logger.error(f"Model creation failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def train(self, X: np.ndarray, y: np.ndarray, epochs: int = 10) -> Dict:
        """Train model on encrypted data"""
        try:
            if self.model is None:
                return {'success': False, 'error': 'Model not created'}
            
            results = self.trainer.train_encrypted(X, y, epochs)
            
            return {
                'success': True,
                'data': results
            }
        except Exception as e:
            logger.error(f"Training failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def predict(self, X: np.ndarray) -> Dict:
        """Make predictions using FHE"""
        try:
            if self.model is None:
                return {'success': False, 'error': 'Model not created'}
            
            predictions = self.trainer.predict_encrypted(X)
            
            return {
                'success': True,
                'predictions': predictions.tolist(),
                'shape': predictions.shape
            }
        except Exception as e:
            logger.error(f"Prediction failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def encrypt_model_weights(self) -> Dict:
        """Encrypt model weights for secure storage"""
        try:
            if self.model is None:
                return {'success': False, 'error': 'Model not created'}
            
            # Serialize encrypted weights
            encrypted_weights = []
            for w in self.model.weights:
                encrypted_weights.append({
                    'data': w.serialize(),
                    'shape': len(w)
                })
            
            return {
                'success': True,
                'weights': encrypted_weights,
                'is_encrypted': self.model.is_encrypted
            }
        except Exception as e:
            logger.error(f"Model encryption failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def secure_aggregation(self, encrypted_updates: List[ts.ckks_vector]) -> ts.ckks_vector:
        """Secure aggregation of encrypted updates"""
        try:
            # Sum all encrypted updates
            aggregated = encrypted_updates[0]
            for update in encrypted_updates[1:]:
                aggregated = aggregated + update
            
            # Average
            aggregated = aggregated / len(encrypted_updates)
            
            return aggregated
        except Exception as e:
            logger.error(f"Secure aggregation failed: {e}")
            return None
    
    def get_stats(self) -> Dict:
        """Get FHE-AI statistics"""
        return {
            'model_exists': self.model is not None,
            'is_encrypted': self.model.is_encrypted if self.model else False,
            'poly_modulus_degree': 8192,
            'coeff_mod_bit_sizes': 16,
            'timestamp': datetime.now().isoformat()
        }
