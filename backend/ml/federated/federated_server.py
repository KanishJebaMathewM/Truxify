import numpy as np
import tensorflow as tf
from tensorflow import keras
import redis
import json
import logging
from typing import List, Dict, Any
from datetime import datetime
import hashlib
import os
from cryptography.fernet import Fernet

logger = logging.getLogger(__name__)

class FederatedServer:
    """Federated Learning Server for Driver Behavior Modeling"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        self.model = self._create_model()
        self.global_weights = None
        self.client_weights = {}
        self.round = 0
        self.min_clients = 3
        self.clients_per_round = 5
        self.encryption_key = Fernet.generate_key()
        self.cipher = Fernet(self.encryption_key)
        
        # Differential Privacy settings
        self.dp_noise_scale = 0.01
        self.dp_clip_norm = 1.0
        
        logger.info("✅ Federated Server initialized")
    
    def _create_model(self):
        """Create driver behavior model"""
        model = keras.Sequential([
            keras.layers.Input(shape=(10,)),  # 10 behavior features
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(1, activation='sigmoid')  # Risk score
        ])
        model.compile(
            optimizer='adam',
            loss='binary_crossentropy',
            metrics=['accuracy']
        )
        return model
    
    def start_round(self):
        """Start new federated learning round"""
        self.round += 1
        
        # Get available clients
        clients = self._get_available_clients()
        if len(clients) < self.min_clients:
            logger.warning(f"Not enough clients: {len(clients)} < {self.min_clients}")
            return None
        
        # Select clients for this round
        selected_clients = clients[:self.clients_per_round]
        
        # Broadcast global model weights
        if self.global_weights is None:
            self.global_weights = self.model.get_weights()
        
        # Send weights to clients
        for client_id in selected_clients:
            self._send_weights_to_client(client_id, self.global_weights)
        
        return {
            'round': self.round,
            'clients': selected_clients,
            'timestamp': datetime.now().isoformat()
        }
    
    def _get_available_clients(self):
        """Get list of available clients"""
        clients = self.redis.smembers('federated:clients')
        return [c.decode('utf-8') for c in clients]
    
    def _send_weights_to_client(self, client_id, weights):
        """Send model weights to client"""
        # Serialize weights
        weights_serialized = [w.tolist() for w in weights]
        weights_json = json.dumps(weights_serialized)
        
        # Encrypt weights
        encrypted = self.cipher.encrypt(weights_json.encode())
        
        # Store in Redis for client
        self.redis.setex(
            f'federated:weights:{client_id}',
            3600,  # 1 hour
            encrypted
        )
        
        # Notify client
        self.redis.publish(
            'federated:updates',
            json.dumps({
                'type': 'weights_available',
                'client_id': client_id,
                'round': self.round
            })
        )
    
    def receive_client_update(self, client_id, encrypted_weights):
        """Receive and process client model updates"""
        try:
            # Decrypt weights
            decrypted = self.cipher.decrypt(encrypted_weights)
            weights = json.loads(decrypted)
            
            # Convert back to numpy arrays
            weights_np = [np.array(w) for w in weights]
            
            # Store client weights
            self.client_weights[client_id] = weights_np
            
            logger.info(f"📥 Received update from client {client_id}")
            
            # Check if all clients have responded
            if len(self.client_weights) >= self.clients_per_round:
                self._aggregate_weights()
            
            return {'success': True}
            
        except Exception as e:
            logger.error(f"Failed to process client update: {e}")
            return {'success': False, 'error': str(e)}
    
    def _aggregate_weights(self):
        """Aggregate client weights using Federated Averaging"""
        if not self.client_weights:
            return
        
        # Apply Differential Privacy
        for client_id in self.client_weights:
            client_w = self.client_weights[client_id]
            # Compute gradients from global weights
            grads = [cw - gw for cw, gw in zip(client_w, self.global_weights)]
            # Clip gradient L2 norm
            total_norm = np.sqrt(sum(np.sum(g**2) for g in grads))
            clip_factor = min(1.0, self.dp_clip_norm / (total_norm + 1e-8))
            clipped_grads = [g * clip_factor for g in grads]
            # Add noise to clipped gradients
            noisy_grads = [g + np.random.normal(0, self.dp_noise_scale, g.shape) for g in clipped_grads]
            # Apply noisy gradients back to weights
            self.client_weights[client_id] = [gw + ng for gw, ng in zip(self.global_weights, noisy_grads)]
        
        # Federated Averaging
        num_clients = len(self.client_weights)
        new_weights = []
        
        for layer_idx in range(len(self.client_weights[list(self.client_weights.keys())[0]])):
            layer_weights = []
            for client_id in self.client_weights:
                layer_weights.append(self.client_weights[client_id][layer_idx])
            
            # Average weights
            avg_weight = np.mean(layer_weights, axis=0)
            new_weights.append(avg_weight)
        
        # Update global model
        self.global_weights = new_weights
        self.model.set_weights(new_weights)
        
        # Log round completion
        logger.info(f"✅ Round {self.round} completed with {num_clients} clients")
        
        # Save model checkpoint
        self._save_checkpoint()
        
        # Clear client weights for next round
        self.client_weights.clear()
        
        # Broadcast updated model to all clients
        self._broadcast_updated_model()
    
    def _save_checkpoint(self):
        """Save model checkpoint"""
        checkpoint_dir = 'models/federated'
        os.makedirs(checkpoint_dir, exist_ok=True)
        
        self.model.save(f'{checkpoint_dir}/model_round_{self.round}.h5')
        self.model.save(f'{checkpoint_dir}/model_latest.h5')
        
        # Save metadata
        metadata = {
            'round': self.round,
            'timestamp': datetime.now().isoformat(),
            'clients': self.clients_per_round,
            'model_version': '1.0'
        }
        
        with open(f'{checkpoint_dir}/metadata.json', 'w') as f:
            json.dump(metadata, f)
    
    def _broadcast_updated_model(self):
        """Broadcast updated model to clients"""
        if self.global_weights is None:
            return
        
        # Serialize weights
        weights_serialized = [w.tolist() for w in self.global_weights]
        weights_json = json.dumps(weights_serialized)
        
        # Encrypt
        encrypted = self.cipher.encrypt(weights_json.encode())
        
        # Store global weights
        self.redis.setex(
            'federated:global_weights',
            86400,  # 24 hours
            encrypted
        )
        
        # Notify all clients
        self.redis.publish(
            'federated:updates',
            json.dumps({
                'type': 'global_weights_updated',
                'round': self.round,
                'timestamp': datetime.now().isoformat()
            })
        )
    
    def get_global_model(self):
        """Get global model weights"""
        if self.global_weights is None:
            return None
        
        return [w.tolist() for w in self.global_weights]
    
    def get_model_stats(self):
        """Get model statistics"""
        stats = {
            'round': self.round,
            'total_clients': len(self._get_available_clients()),
            'model_version': '1.0',
            'timestamp': datetime.now().isoformat()
        }
        
        # Get model metrics
        if self.global_weights:
            # Evaluate on sample data
            sample = np.random.randn(10, 10)
            prediction = self.model.predict(sample)
            stats['sample_prediction'] = prediction.mean().item()
        
        return stats