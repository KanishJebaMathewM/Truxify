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

from .fl_server import robust_aggregate

logger = logging.getLogger(__name__)


def atomic_getdel(redis_client, key: str):
    """Atomically retrieve and delete a key from Redis.

    Uses GETDEL when supported (Redis 6.2+), falling back to a pipeline/transaction
    or GET followed by DEL to prevent duplicate processing.
    """
    if hasattr(redis_client, "getdel"):
        try:
            val = redis_client.getdel(key)
            if val is not None:
                return val
        except Exception:
            pass
    try:
        if hasattr(redis_client, "pipeline"):
            pipe = redis_client.pipeline()
            pipe.get(key)
            pipe.delete(key)
            res = pipe.execute()
            if isinstance(res, (list, tuple)) and len(res) > 0:
                return res[0]
    except Exception:
        pass
    try:
        val = redis_client.get(key)
        if val is not None:
            redis_client.delete(key)
            return val
    except Exception:
        pass
    return None


class FederatedServer:
    """Federated Learning Server for Driver Behavior Modeling"""
    
    def __init__(
        self,
        redis_url: str = "redis://localhost:6379",
        min_clients: int = 3,
        clients_per_round: int = 5,
    ):
        self.min_clients = min_clients
        self.clients_per_round = clients_per_round
        if self.clients_per_round < self.min_clients:
            raise ValueError(
                f"clients_per_round ({self.clients_per_round}) must be >= min_clients ({self.min_clients})"
            )

        self.redis = redis.Redis.from_url(redis_url)
        self.model = self._create_model()
        self.global_weights = None
        self.client_weights = {}
        self.round = 0
        self.accepted_updates = set()
        self.completed_rounds = set()
        self.round_completed = False
        self.selected_clients = []
        self.current_round = None
        self.pubsub = None
        self._consumer_thread = None
        self.encryption_key = Fernet.generate_key()
        self.cipher = Fernet(self.encryption_key)

        try:
            self.redis.setex('federated:encryption_key', 86400, self.encryption_key)
            # Restore round + accepted set so restarts don't re-accept updates.
            self._load_persisted_state()
        except Exception as e:
            logger.warning(f"Could not connect to Redis on init: {e}")

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
        # Get available clients
        clients = self._get_available_clients()
        if len(clients) < self.min_clients:
            logger.warning(f"Not enough clients: {len(clients)} < {self.min_clients}")
            return None

        self.round += 1

        # Select clients for this round
        selected_count = min(self.clients_per_round, len(clients))
        selected_clients = clients[:selected_count]
        # Reset round state so a new round starts from a clean slate and the
        # aggregation threshold reflects only this round's participants.
        self.selected_clients = selected_clients
        self.current_round = self.round
        self.client_weights.clear()
        self.round_completed = False

        try:
            self.redis.set('federated:round', self.round)
            self.redis.set('federated:selected_clients', json.dumps(selected_clients))
        except Exception as e:
            logger.warning(f"Could not persist round to Redis: {e}")

        # Start update consumer if not already running
        self.start_update_consumer()

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
        try:
            clients = self.redis.smembers('federated:clients')
            return [c.decode('utf-8') for c in clients]
        except Exception as e:
            logger.warning(f"Could not fetch clients from Redis: {e}")
            return []

    def _is_authorized_client(self, client_id):
        """Return True only if ``client_id`` is registered and selected this round.

        Prevents unauthenticated callers from injecting model updates: the
        sender must both be a known/registered client and have been selected as
        a participant in the current round.
        """
        if client_id in self.client_weights:
            # Already submitted for this round; ignore duplicate updates.
            return False
        registered = client_id in self._get_available_clients()
        selected = client_id in self.selected_clients
        return registered and selected

    def _send_weights_to_client(self, client_id, weights):
        """Send model weights to client with round metadata envelope"""
        # Serialize weights with round metadata envelope
        weights_serialized = [w.tolist() for w in weights]
        payload = {
            'round': self.round,
            'weights': weights_serialized,
        }
        weights_json = json.dumps(payload)

        # Encrypt weights
        encrypted = self.cipher.encrypt(weights_json.encode())

        # Store in Redis for client
        try:
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
        except Exception as e:
            logger.warning(f"Failed to send weights to client {client_id}: {e}")

    def _load_persisted_state(self):
        """Restore current round, selected clients, and accepted (client_id, round) set."""
        try:
            saved_round = self.redis.get('federated:round')
            if saved_round is not None and isinstance(saved_round, (int, str, bytes)):
                try:
                    self.round = int(saved_round)
                    self.current_round = self.round
                except (TypeError, ValueError):
                    pass
            saved_selected = self.redis.get('federated:selected_clients')
            if saved_selected is not None and isinstance(saved_selected, (str, bytes)):
                try:
                    self.selected_clients = json.loads(saved_selected)
                except Exception:
                    pass
            saved_accepted = self.redis.get('federated:accepted')
            if saved_accepted is not None and isinstance(saved_accepted, (str, bytes)):
                try:
                    self.accepted_updates = set(
                        tuple(t) for t in json.loads(saved_accepted)
                    )
                except (TypeError, ValueError):
                    pass
        except Exception:
            pass

    def _persist_accepted(self):
        """Persist current round and the set of accepted (client_id, round)."""
        try:
            self.redis.set('federated:round', self.round)
            self.redis.set(
                'federated:accepted',
                json.dumps([list(t) for t in self.accepted_updates]),
            )
        except Exception:
            logger.warning("Failed to persist federated round state")

    def drain_pending_client_updates(self):
        """Consume any pending client updates from federated:update:{client_id}
        for all selected clients. Atomically gets and deletes the key to prevent
        duplicate processing."""
        consumed = 0
        for client_id in list(self.selected_clients):
            if client_id in self.client_weights:
                continue
            key = f"federated:update:{client_id}"
            encrypted = atomic_getdel(self.redis, key)
            if encrypted:
                res = self.receive_client_update(client_id, encrypted)
                if res and res.get("success") and not res.get("duplicate"):
                    consumed += 1
        return consumed

    def start_update_consumer(self):
        """Start a background listener thread on federated:updates channel."""
        if getattr(self, '_consumer_thread', None) is not None:
            return

        try:
            self.pubsub = self.redis.pubsub()

            def _on_message(message):
                if not message or message.get('type') != 'message':
                    return
                try:
                    raw_data = message.get('data')
                    if isinstance(raw_data, bytes):
                        raw_data = raw_data.decode('utf-8')
                    event = json.loads(raw_data)
                    if event.get('type') == 'client_update':
                        client_id = event.get('client_id')
                        if client_id and client_id in self.selected_clients:
                            key = f'federated:update:{client_id}'
                            encrypted = atomic_getdel(self.redis, key)
                            if encrypted:
                                self.receive_client_update(client_id, encrypted)
                except Exception as exc:
                    logger.error(f"Error in federated update consumer: {exc}")

            self.pubsub.subscribe(**{'federated:updates': _on_message})
            self._consumer_thread = self.pubsub.run_in_thread(daemon=True, sleep_time=0.01)
            logger.info("📡 Federated update consumer started")
        except Exception as e:
            logger.warning(f"Could not start Pub/Sub update consumer: {e}")
            self.pubsub = None
            self._consumer_thread = None

    def stop_update_consumer(self):
        """Stop background listener thread."""
        if getattr(self, '_consumer_thread', None) is not None:
            try:
                self._consumer_thread.stop()
            except Exception:
                pass
            self._consumer_thread = None
        if getattr(self, 'pubsub', None) is not None:
            try:
                self.pubsub.close()
            except Exception:
                pass
            self.pubsub = None

    def receive_client_update(self, client_id, encrypted_weights):
        """Receive and process a client model update.

        The encrypted envelope carries the ``round`` the update was computed
        against. Updates whose round does not match the server's current round
        are rejected (stale cross-round / replayed updates), and duplicates
        keyed by ``(client_id, round)`` are dropped.
        """
        try:
            if getattr(self, 'round_completed', False) or self.round in getattr(self, 'completed_rounds', set()):
                logger.warning(f"Rejected update from {client_id}: round {self.round} already completed")
                return {'success': False, 'error': f'Round {self.round} is already completed'}

            if self.selected_clients and client_id not in self.selected_clients:
                logger.warning(
                    f"Rejected update from {client_id}: client not selected for round {self.round}"
                )
                return {'success': False, 'error': 'unauthorized client or not selected this round'}

            # Decrypt the envelope
            decrypted = self.cipher.decrypt(encrypted_weights)
            payload = json.loads(decrypted)

            if isinstance(payload, dict):
                update_round = payload.get('round')
                weights = payload.get('weights')
            elif isinstance(payload, list):
                # Backward compatibility with legacy list updates
                update_round = self.round
                weights = payload
            else:
                logger.warning(f"Rejected update from {client_id}: invalid payload structure")
                return {'success': False, 'error': 'invalid payload structure'}

            # Reject updates without a round tag
            if update_round is None:
                logger.warning(f"Rejected update from {client_id}: missing round tag")
                return {'success': False, 'error': 'missing round tag'}

            # Reject stale / cross-round / replayed updates
            if update_round != self.round:
                logger.warning(
                    f"Rejected stale update from {client_id}: update round "
                    f"{update_round} != current round {self.round}"
                )
                return {'success': False, 'error': 'stale round'}

            # Drop duplicates for the same (client, round)
            if (client_id, update_round) in self.accepted_updates or client_id in self.client_weights:
                logger.info(
                    f"Dropped duplicate update from {client_id} (round {update_round})"
                )
                return {'success': True, 'duplicate': True}

            # Convert back to numpy arrays
            weights_np = [np.array(w) for w in weights]

            # Store client weights (current-round only)
            self.client_weights[client_id] = weights_np
            self.accepted_updates.add((client_id, update_round))
            self._persist_accepted()

            logger.info(f"📥 Received update from client {client_id} (round {update_round})")

            # Check if all selected clients for this round have responded
            if self.selected_clients and len(self.client_weights) >= len(self.selected_clients):
                self._aggregate_weights()

            return {'success': True}

        except Exception as e:
            logger.error(f"Failed to process client update: {e}")
            return {'success': False, 'error': str(e)}

    def _aggregate_weights(self):
        """Aggregate client weights using Federated Averaging"""
        if getattr(self, 'round_completed', False) or self.round in getattr(self, 'completed_rounds', set()):
            logger.warning(f"Round {self.round} already aggregated; skipping duplicate aggregation")
            return False

        if not self.client_weights:
            return False

        num_clients = len(self.client_weights)

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

        # Robust Federated Aggregation: coordinate-wise median (byzantine-robust)
        # instead of a naive plain mean, so a single malicious or compromised
        # client submitting extreme weights cannot skew the global model. The
        # per-layer delta from the previous global weights is also clipped.
        new_weights = []

        for layer_idx in range(len(self.client_weights[list(self.client_weights.keys())[0]])):
            layer_weights = []
            for client_id in self.client_weights:
                layer_weights.append(self.client_weights[client_id][layer_idx])

            global_layer = (
                self.global_weights[layer_idx] if self.global_weights else None
            )
            agg_weight = robust_aggregate(
                layer_weights,
                global_layer,
                clip_norm=self.dp_clip_norm,
            )
            new_weights.append(agg_weight)

        # Update global model
        self.global_weights = new_weights
        self.model.set_weights(new_weights)

        # Mark round as completed to prevent duplicate aggregation
        self.round_completed = True
        self.completed_rounds.add(self.round)
        try:
            self.redis.set(f'federated:round_completed:{self.round}', 'true')
        except Exception:
            pass

        # Log round completion
        logger.info(f"✅ Round {self.round} completed with {num_clients} clients")

        # Save model checkpoint
        self._save_checkpoint()

        # Clear client weights for next round
        self.client_weights.clear()

        # Broadcast updated model to all clients
        self._broadcast_updated_model()

        return {
            'success': True,
            'round': self.round,
            'clients_aggregated': num_clients
        }
    
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