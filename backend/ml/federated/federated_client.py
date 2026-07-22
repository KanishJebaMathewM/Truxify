import numpy as np
import tensorflow as tf
from tensorflow import keras
import redis
import json
import logging
from typing import Dict, Any
from cryptography.fernet import Fernet
import os
import time

logger = logging.getLogger(__name__)

class FederatedClient:
    """Federated Learning Client for Driver Device"""
    
    def __init__(self, client_id: str, redis_url: str = "redis://localhost:6379"):
        self.client_id = client_id
        self.redis = redis.Redis.from_url(redis_url)
        self.model = self._create_model()
        self.local_data = None
        self.encryption_key = None
        self.cipher = None
        self.training_round = 0
        
        # Register client
        self._register_client()
        
        # Subscribe to updates
        self._subscribe_updates()
        
        logger.info(f"✅ Federated Client {client_id} initialized")
    
    def _create_model(self):
        """Create local model"""
        model = keras.Sequential([
            keras.layers.Input(shape=(10,)),
            keras.layers.Dense(64, activation='relu'),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(32, activation='relu'),
            keras.layers.Dropout(0.2),
            keras.layers.Dense(1, activation='sigmoid')
        ])
        model.compile(
            optimizer='adam',
            loss='binary_crossentropy',
            metrics=['accuracy']
        )
        return model
    
    def _register_client(self):
        """Register client with server"""
        self.redis.sadd('federated:clients', self.client_id)
        
        # Set encryption key if not exists
        if not self.redis.exists(f'federated:key:{self.client_id}'):
            key = Fernet.generate_key()
            self.redis.setex(
                f'federated:key:{self.client_id}',
                86400 * 7,  # 7 days
                key
            )
        
        self.encryption_key = self.redis.get(f'federated:key:{self.client_id}')
        self.cipher = Fernet(self.encryption_key)
    
    def _subscribe_updates(self):
        """Subscribe to server updates"""
        pubsub = self.redis.pubsub()
        pubsub.subscribe('federated:updates')
        
        # Process updates in background
        # In production, use threading
        pass
    
    def receive_weights(self):
        """Receive model weights from server"""
        encrypted = self.redis.get(f'federated:weights:{self.client_id}')
        if encrypted:
            # Decrypt
            decrypted = self.cipher.decrypt(encrypted)
            weights = json.loads(decrypted)
            
            # Convert to numpy
            weights_np = [np.array(w) for w in weights]
            
            # Update local model
            self.model.set_weights(weights_np)
            
            logger.info(f"📥 Received weights for round {self.training_round}")
            return True
        
        return False
    
    def train_local(self, data: np.ndarray, labels: np.ndarray, epochs: int = 5):
        """Train local model on driver data"""
        try:
            self.local_data = (data, labels)
            
            # Train locally
            history = self.model.fit(
                data, labels,
                epochs=epochs,
                batch_size=32,
                verbose=0
            )
            
            logger.info(f"📊 Local training completed: loss={history.history['loss'][-1]:.4f}")
            
            return {
                'success': True,
                'loss': history.history['loss'][-1],
                'accuracy': history.history['accuracy'][-1]
            }
            
        except Exception as e:
            logger.error(f"Local training failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def send_update(self):
        """Send model update to server"""
        try:
            # Get local model weights
            weights = self.model.get_weights()
            weights_serialized = [w.tolist() for w in weights]
            weights_json = json.dumps(weights_serialized)
            
            # Encrypt
            encrypted = self.cipher.encrypt(weights_json.encode())
            
            # Send to server via Redis
            self.redis.setex(
                f'federated:update:{self.client_id}',
                3600,
                encrypted
            )
            
            # Notify server
            self.redis.publish(
                'federated:updates',
                json.dumps({
                    'type': 'client_update',
                    'client_id': self.client_id,
                    'round': self.training_round
                })
            )
            
            logger.info(f"📤 Sent update to server")
            return {'success': True}
            
        except Exception as e:
            logger.error(f"Failed to send update: {e}")
            return {'success': False, 'error': str(e)}
    
    def participate_in_round(self, data: np.ndarray, labels: np.ndarray, epochs: int = 5):
        """Full participation in federated learning round"""
        try:
            # Receive global weights
            self.receive_weights()
            
            # Train locally
            training_result = self.train_local(data, labels, epochs)
            
            if training_result['success']:
                # Send update
                update_result = self.send_update()
                self.training_round += 1
                
                return {
                    'success': True,
                    'training': training_result,
                    'update': update_result,
                    'round': self.training_round
                }
            else:
                return training_result
                
        except Exception as e:
            logger.error(f"Round participation failed: {e}")
            return {'success': False, 'error': str(e)}
    
    def simulate_driver_behavior(self, num_samples: int = 100):
        """Simulate driver behavior data"""
        # Features: speed, acceleration, braking, cornering, etc.
        np.random.seed(int(time.time()) % 1000 + hash(self.client_id) % 1000)
        
        data = np.random.randn(num_samples, 10)
        
        # Labels: risky (1) or safe (0)
        # Safe drivers: 0, Risky drivers: 1
        threshold = 0.5
        labels = (data.sum(axis=1) > threshold).astype(int)
        
        return data, labels
    
    def start_federated_learning(self, rounds: int = 10, epochs_per_round: int = 5):
        """Start federated learning process"""
        results = []
        
        for round_num in range(rounds):
            logger.info(f"🔄 Starting round {round_num + 1}/{rounds}")
            
            # Get local data (simulated)
            data, labels = self.simulate_driver_behavior()
            
            # Participate in round
            result = self.participate_in_round(data, labels, epochs_per_round)
            results.append(result)
            
            if result['success']:
                logger.info(f"✅ Round {round_num + 1} completed")
            else:
                logger.error(f"❌ Round {round_num + 1} failed")
        
        return results