import numpy as np
import tensorflow as tf
from tensorflow import keras
import redis
import json
import logging
from typing import Dict, Any, Optional, List
from cryptography.fernet import Fernet, MultiFernet, InvalidToken
import os
import time
from threading import RLock

from .client_round_protocol import MAX_MODEL_ENVELOPE_BYTES, admit_round_model, round_owned

logger = logging.getLogger(__name__)


def is_valid_fernet_key(key: Any) -> bool:
    """Validate whether key is a valid 32-byte url-safe base64-encoded Fernet key."""
    if not key or not isinstance(key, (bytes, str)):
        return False
    try:
        Fernet(key)
        return True
    except Exception:
        return False


class FederatedClient:
    """Federated Learning Client for Driver Device"""
    
    def __init__(self, client_id: str, redis_url: Any = "redis://localhost:6379"):
        self._round_lock = RLock()
        self._accepted_round = None
        self._round_model = None
        self._trained_round = None
        self._published_round = None
        self._training_result = None
        self.client_id = client_id
        if isinstance(redis_url, str):
            self.redis = redis.Redis.from_url(redis_url)
        else:
            self.redis = redis_url
        self.model = self._create_model()
        self.local_data = None
        self.encryption_key = None
        self.historical_keys: List[bytes] = []
        self.cipher = None
        self.training_round = 0
        self.pubsub = None
        self._sub_thread = None

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
        """Register client with server, refresh registration TTL, and load encryption key."""
        try:
            self.redis.sadd('federated:clients', self.client_id)
            self.redis.setex(f'federated:client:{self.client_id}:ttl', 86400, 'active')

            self.refresh_encryption_key()
        except Exception as e:
            logger.warning(f"Failed to register client {self.client_id} with Redis: {e}")

    def refresh_encryption_key(self) -> bool:
        """Fetch the latest active encryption key and historical keys from Redis and initialize cipher.

        Returns True if a valid key was retrieved and cipher configured, False otherwise.
        """
        try:
            raw_key = self.redis.get('federated:encryption_key')
            if not raw_key:
                logger.warning(f"No server encryption key found in Redis for client {self.client_id}")
                return False

            key_bytes = raw_key.encode('utf-8') if isinstance(raw_key, str) else raw_key
            if not is_valid_fernet_key(key_bytes):
                logger.warning(f"Malformed encryption key found in Redis for client {self.client_id}")
                return False

            # Archive previous active key if rotating
            if self.encryption_key and self.encryption_key != key_bytes and self.encryption_key not in self.historical_keys:
                self.historical_keys.insert(0, self.encryption_key)

            self.encryption_key = key_bytes
            self._load_historical_keys()
            self._build_cipher()
            logger.debug(f"🔑 Client {self.client_id} updated encryption cipher from Redis")
            return True
        except Exception as e:
            logger.warning(f"Error refreshing encryption key for client {self.client_id}: {e}")
            return False

    def _load_historical_keys(self):
        """Load historical encryption keys from Redis."""
        try:
            members = self.redis.smembers('federated:keys:history')
            if members:
                for m in members:
                    m_bytes = m.encode('utf-8') if isinstance(m, str) else m
                    if is_valid_fernet_key(m_bytes) and m_bytes != self.encryption_key:
                        if m_bytes not in self.historical_keys:
                            self.historical_keys.append(m_bytes)
        except Exception as e:
            logger.warning(f"Failed to load historical keys from Redis for client {self.client_id}: {e}")

    def _build_cipher(self):
        """Build MultiFernet cipher using active key as primary and historical keys for decryption fallback."""
        if not self.encryption_key or not is_valid_fernet_key(self.encryption_key):
            self.cipher = None
            return
        fernets = [Fernet(self.encryption_key)] + [
            Fernet(k) for k in self.historical_keys if is_valid_fernet_key(k)
        ]
        self.cipher = MultiFernet(fernets)

    def _subscribe_updates(self):
        """Subscribe to server updates via Redis Pub/Sub"""
        try:
            self.pubsub = self.redis.pubsub()

            def _handler(msg):
                if msg and msg.get('type') == 'message':
                    try:
                        raw = msg.get('data')
                        if isinstance(raw, bytes):
                            raw = raw.decode('utf-8')
                        data = json.loads(raw)
                        if data.get('type') == 'weights_available' and data.get('client_id') == self.client_id:
                            self.receive_weights()
                    except Exception as exc:
                        logger.error(f"Error handling client update notice: {exc}")

            self.pubsub.subscribe(**{'federated:updates': _handler})
            self._sub_thread = self.pubsub.run_in_thread(daemon=True, sleep_time=0.01)
        except Exception as e:
            logger.warning(f"Could not start client update subscription: {e}")
            self.pubsub = None
            self._sub_thread = None

    def stop_subscription(self):
        """Stop background subscription thread"""
        if getattr(self, '_sub_thread', None) is not None:
            try:
                self._sub_thread.stop()
            except Exception:
                pass
            self._sub_thread = None
        if getattr(self, 'pubsub', None) is not None:
            try:
                self.pubsub.close()
            except Exception:
                pass
            self.pubsub = None

    @round_owned
    def receive_weights(self):
        """Receive model weights from server and synchronize active round"""
        try:
            encrypted = self.redis.get(f'federated:weights:{self.client_id}')
            if not encrypted:
                return False
            if not isinstance(encrypted, bytes) or len(encrypted) > MAX_MODEL_ENVELOPE_BYTES:
                return False

            if not self.cipher:
                if not self.refresh_encryption_key() or not self.cipher:
                    logger.warning(f"Cannot decrypt weights for client {self.client_id}: encryption cipher unavailable")
                    return False

            decrypted = None
            try:
                decrypted = self.cipher.decrypt(encrypted)
            except InvalidToken:
                logger.warning(f"InvalidToken decrypting weights for client {self.client_id}; attempting key refresh")
                if self.refresh_encryption_key() and self.cipher:
                    try:
                        decrypted = self.cipher.decrypt(encrypted)
                    except InvalidToken:
                        logger.error(f"Failed to decrypt weights after key refresh for client {self.client_id}: InvalidToken")
                        return False
                else:
                    logger.error(f"Failed to refresh key following InvalidToken for client {self.client_id}")
                    return False

            payload = json.loads(decrypted)

            round_id, weights_np = admit_round_model(
                payload, self.model.get_weights(),
                self.redis.get('federated:round') if isinstance(payload, list) else None,
            )
            if self._accepted_round is not None:
                if round_id < self._accepted_round:
                    return False
                if round_id == self._accepted_round:
                    # Duplicate notices must not replace a trained local model.
                    return all(np.array_equal(a, b) for a, b in zip(weights_np, self._round_model))

            self.model.set_weights(weights_np)
            self.training_round = round_id
            self._accepted_round = round_id
            self._round_model = [w.copy() for w in weights_np]
            self._trained_round = None
            self._published_round = None
            self._training_result = None

            logger.info(f"📥 Received weights for round {self.training_round}")
            return True
        except Exception as e:
            logger.warning(f"Failed to receive weights for client {self.client_id}: {e}")

        return False
    
    @round_owned
    def train_local(self, data: np.ndarray, labels: np.ndarray, epochs: int = 5):
        """Train local model on driver data"""
        try:
            if self._accepted_round is None or self.training_round != self._accepted_round:
                return {'success': False, 'error': 'No accepted server model round'}
            if self._trained_round == self.training_round:
                return dict(self._training_result, duplicate=True)
            self.local_data = (data, labels)
            
            # Train locally
            history = self.model.fit(
                data, labels,
                epochs=epochs,
                batch_size=32,
                verbose=0
            )

            hist = getattr(history, 'history', {}) if history is not None else {}
            loss = hist.get('loss', [0.0])[-1] if 'loss' in hist and len(hist['loss']) > 0 else 0.0
            acc = hist.get('accuracy', [1.0])[-1] if 'accuracy' in hist and len(hist['accuracy']) > 0 else 1.0

            loss_val = float(loss) if isinstance(loss, (int, float, np.number)) else 0.0
            acc_val = float(acc) if isinstance(acc, (int, float, np.number)) else 1.0

            logger.info(f"📊 Local training completed: loss={loss_val:.4f}")

            if not np.isfinite(loss_val) or not np.isfinite(acc_val) or any(
                not np.isfinite(w).all() for w in self.model.get_weights()
            ):
                return {'success': False, 'error': 'Local training produced a nonfinite model or metrics'}
            self._training_result = {'success': True, 'loss': loss_val, 'accuracy': acc_val}
            self._trained_round = self.training_round
            return dict(self._training_result)
            
        except Exception as e:
            logger.error(f"Local training failed: {e}")
            return {'success': False, 'error': str(e)}
    
    @round_owned
    def send_update(self):
        """Send model update to server"""
        try:
            if self._accepted_round is None or self._trained_round != self.training_round:
                return {'success': False, 'error': 'No trained accepted round to publish'}
            if self._published_round == self.training_round:
                return {'success': True, 'duplicate': True}
            # Get local model weights
            weights = self.model.get_weights()
            if any(not np.isfinite(w).all() for w in weights):
                return {'success': False, 'error': 'Trained model is not finite'}
            weights_serialized = [w.tolist() for w in weights]

            # Envelope carries the round this update was computed against so the
            # server can reject stale cross-round / replayed updates.
            payload = {
                'round': self.training_round,
                'weights': weights_serialized,
            }
            weights_json = json.dumps(payload, allow_nan=False)

            if not self.cipher:
                if not self.refresh_encryption_key() or not self.cipher:
                    logger.error(f"Failed to send update for client {self.client_id}: cipher not initialized")
                    return {'success': False, 'error': 'Encryption cipher unavailable'}

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
            
            self._published_round = self.training_round
            logger.info(f"📤 Sent update to server")
            return {'success': True}
            
        except Exception as e:
            logger.error(f"Failed to send update: {e}")
            return {'success': False, 'error': str(e)}
    
    @round_owned
    def participate_in_round(self, data: np.ndarray, labels: np.ndarray, epochs: int = 5):
        """Full participation in federated learning round"""
        try:
            # Receive global weights
            if not self.receive_weights():
                return {'success': False, 'error': 'No valid server model received'}

            # Train locally
            training_result = self.train_local(data, labels, epochs)
            
            if training_result['success']:
                # Send update
                update_result = self.send_update()
                participated_round = self.training_round
                return {
                    'success': bool(update_result.get('success')),
                    'training': training_result,
                    'update': update_result,
                    'round': participated_round
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