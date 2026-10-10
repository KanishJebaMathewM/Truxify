import numpy as np
import redis
import json
import logging
from collections import deque
from datetime import datetime
from typing import Dict, List, Any, Optional
from .models import LSTMAutoencoder
from threading import RLock
from pathlib import Path
from .generation_contract import admit_training, capture, prepare_candidate, finite_array

logger = logging.getLogger(__name__)

class AnomalyDetector:
    """Real-time Anomaly Detection Service"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        self._generation_lock = RLock()
        self._training_lock = RLock()
        self._generations = {}
        
        # Initialize models for different data types
        self.models = {
            'driver_behavior': LSTMAutoencoder(input_dim=10, sequence_length=60),
            'transactions': LSTMAutoencoder(input_dim=8, sequence_length=30),
            'gps_tracking': LSTMAutoencoder(input_dim=4, sequence_length=50)
        }
        
        # Scalers
        self.scalers = {}
        
        # Alert thresholds
        self.alert_thresholds = {
            'low': 1.5,
            'medium': 2.0,
            'high': 3.0
        }
        
        # Initialize models
        for name, model in self.models.items():
            model.build_model()
        
        self.max_history = 1000
        self.anomaly_history = deque(maxlen=self.max_history)

        # Per-(data_type, entity) rolling buffers of recent feature vectors.
        # Real-time detection feeds these genuine windows to the model instead
        # of tiling a single timestep into a constant sequence, which was out
        # of distribution for models trained on diverse multi-step sequences
        # (issue #11669).
        self._feature_buffers = {}

        logger.info("✅ Anomaly Detector initialized")

    def _get_feature_buffer(self, data_type: str, entity_key: str):
        """Get (or create) the rolling feature buffer for an entity."""
        key = (data_type, entity_key or 'default')
        if key not in self._feature_buffers:
            seq_len = self.models[data_type].sequence_length
            self._feature_buffers[key] = deque(maxlen=seq_len)
        return self._feature_buffers[key]
    
    def train_models(self, data: Dict[str, np.ndarray], epochs: int = 1):
        """Fit privately, then publish every requested runtime generation together."""
        with self._training_lock:
            with self._generation_lock:
                owned = admit_training(data, self.models, epochs)
                snapshots = {name: capture(self.models[name]) for name in owned}
            candidates = {}
            for name, raw in owned.items():
                candidates[name] = prepare_candidate(snapshots[name], raw, epochs)
            # Legacy files are not a crash-atomic multi-file checkpoint. An I/O
            # failure can alter disk files, but cannot publish runtime candidates.
            Path('models').mkdir(parents=True, exist_ok=True)
            for name, (model, _, _) in candidates.items():
                model.save(f'models/anomaly_{name}')
            with self._generation_lock:
                for name, (model, scaler, result) in candidates.items():
                    self.models[name] = model
                    self.scalers[name] = scaler
                    self._generations[name] = self._generations.get(name, 0) + 1
                    result['generation'] = self._generations[name]
                self._feature_buffers = {
                    key: value for key, value in self._feature_buffers.items()
                    if key[0] not in candidates
                }
                return {name: result for name, (_, _, result) in candidates.items()}

    def detect_anomaly(self, data_type: str, data: np.ndarray, entity_key: str = None) -> Dict:
        """Consume one paired generation and commit only a valid temporal frame."""
        try:
            with self._generation_lock:
                if data_type not in self.models:
                    raise ValueError(f'Unknown data type: {data_type}')
                model = self.models[data_type]
                scaler = self.scalers.get(data_type)
                if scaler is None or model.threshold is None or not np.isfinite(model.threshold) or model.threshold <= 0:
                    raise ValueError('A calibrated model/scaler generation is required')
                owned = finite_array(data, 'observation')
                if owned.shape == (model.input_dim,):
                    owned = owned.reshape(1, -1)
                if owned.shape != (1, model.input_dim):
                    raise ValueError(f'Expected exactly one observation with {model.input_dim} features')
                with np.errstate(over='raise', invalid='raise', divide='raise'):
                    scaled = scaler.transform(owned).astype(np.float32)
                if not np.isfinite(scaled).all():
                    raise ValueError('Observation is not representable after normalization')
                key = (data_type, entity_key or 'default')
                previous = self._feature_buffers.get(key, ())
                seq = (list(previous) + [scaled[0]])[-model.sequence_length:]
                if len(seq) < model.sequence_length:
                    seq = [seq[0]] * (model.sequence_length - len(seq)) + seq
                window = np.array(seq, dtype=np.float32)
                raw_result = model.get_anomaly_score(window)
                score = float(raw_result['anomaly_score'])
                error = float(raw_result['reconstruction_error'])
                if not np.isfinite([score, error]).all() or min(score, error) < 0:
                    raise ValueError('Native reconstruction score is nonfinite or negative')
                if score >= self.alert_thresholds['high']:
                    severity = 'CRITICAL'
                elif score >= self.alert_thresholds['medium']:
                    severity = 'WARNING'
                elif score >= self.alert_thresholds['low']:
                    severity = 'INFO'
                else:
                    severity = 'NORMAL'
                result = {
                    'reconstruction_error': error, 'anomaly_score': score,
                    'is_anomaly': bool(raw_result['is_anomaly']),
                    'data_type': data_type, 'severity': severity,
                    'timestamp': datetime.now().isoformat(), 'data': owned.tolist(),
                    'generation': self._generations.get(data_type, 0),
                }
                encoded = json.dumps(result, allow_nan=False)
                buffer = self._get_feature_buffer(data_type, entity_key)
                buffer.append(scaled[0].copy())
                if result['is_anomaly']:
                    self.anomaly_history.append(result)
                    self.redis.setex(f'anomaly:latest:{data_type}', 3600, encoded)
                    self.redis.publish('anomaly:alerts', json.dumps({
                        'type': data_type, 'severity': severity, 'data': result,
                        'timestamp': datetime.now().isoformat(),
                    }, allow_nan=False))
                return result
        except Exception as e:
            logger.error(f'Anomaly detection failed: {e}')
            return {'error': str(e)}

    def set_threshold(self, data_type, threshold):
        value = float(threshold)
        if not np.isfinite(value) or value <= 0:
            raise ValueError('threshold must be positive and finite')
        with self._training_lock, self._generation_lock:
            self.models[data_type].threshold = value

    def get_threshold(self, data_type):
        with self._generation_lock:
            return self.models[data_type].threshold

    def detect_driver_anomaly(self, driver_data: Dict) -> Dict:
        """Detect anomalies in driver behavior"""
        try:
            # Extract features
            features = self._extract_driver_features(driver_data)
            
            # Detect anomaly (window keyed per driver)
            result = self.detect_anomaly(
                'driver_behavior',
                features,
                entity_key=str(driver_data.get('driver_id') or '')
            )
            
            # Add driver-specific info
            result['driver_id'] = driver_data.get('driver_id')
            result['timestamp'] = datetime.now().isoformat()
            
            return result
            
        except Exception as e:
            logger.error(f"Driver anomaly detection failed: {e}")
            return {'error': str(e)}
    
    def detect_transaction_anomaly(self, transaction: Dict) -> Dict:
        """Detect anomalies in transactions"""
        try:
            # Extract features
            features = self._extract_transaction_features(transaction)

            # Detect anomaly (window keyed per stable entity, NOT the unique
            # transaction_id). Keying per transaction_id created a fresh 1-element
            # buffer for every tx that was front-padded into a constant sequence,
            # so the anomaly score could never cross the threshold (issue #13900).
            entity_id = (
                transaction.get('account_id')
                or transaction.get('customer_id')
                or transaction.get('card_id')
                or transaction.get('user_id')
                or transaction.get('transaction_id')
            )
            result = self.detect_anomaly(
                'transactions',
                features,
                entity_key=str(entity_id or '')
            )
            
            # Add transaction-specific info
            result['transaction_id'] = transaction.get('transaction_id')
            result['timestamp'] = datetime.now().isoformat()
            
            return result
            
        except Exception as e:
            logger.error(f"Transaction anomaly detection failed: {e}")
            return {'error': str(e)}
    
    def detect_gps_anomaly(self, gps_data: Dict) -> Dict:
        """Detect anomalies in GPS data"""
        try:
            # Extract features
            features = self._extract_gps_features(gps_data)
            
            # Detect anomaly (window keyed per driver)
            result = self.detect_anomaly(
                'gps_tracking',
                features,
                entity_key=str(gps_data.get('driver_id') or '')
            )
            
            # Add GPS-specific info
            result['driver_id'] = gps_data.get('driver_id')
            result['timestamp'] = datetime.now().isoformat()
            
            return result
            
        except Exception as e:
            logger.error(f"GPS anomaly detection failed: {e}")
            return {'error': str(e)}
    
    def _extract_driver_features(self, data: Dict) -> np.ndarray:
        """Extract features from driver data"""
        features = [
            data.get('speed', 0),
            data.get('acceleration', 0),
            data.get('braking', 0),
            data.get('steering_angle', 0),
            data.get('lane_departure', 0),
            data.get('eye_aspect_ratio', 1.0),
            data.get('head_pose_x', 0),
            data.get('head_pose_y', 0),
            data.get('heart_rate', 70),
            data.get('stress_level', 0)
        ]
        return np.array(features).reshape(1, -1)
    
    def _extract_transaction_features(self, data: Dict) -> np.ndarray:
        """Extract features from transaction data"""
        features = [
            data.get('amount', 0),
            data.get('frequency', 1),
            data.get('time_of_day', 12),
            data.get('day_of_week', 3),
            data.get('location_risk', 0),
            data.get('device_risk', 0),
            data.get('ip_risk', 0),
            data.get('pattern_deviation', 0)
        ]
        return np.array(features).reshape(1, -1)
    
    def _extract_gps_features(self, data: Dict) -> np.ndarray:
        """Extract features from GPS data"""
        features = [
            data.get('speed', 0),
            data.get('acceleration', 0),
            data.get('direction_change', 0),
            data.get('route_deviation', 0)
        ]
        return np.array(features).reshape(1, -1)
    
    def get_anomaly_history(self, data_type: Optional[str] = None) -> List[Dict]:
        """Get anomaly detection history"""
        with self._generation_lock:
            history = list(self.anomaly_history)
        if data_type:
            return [h for h in history if h.get('data_type') == data_type]
        return history
    
    def get_alerts(self, severity: Optional[str] = None) -> List[Dict]:
        """Get recent alerts"""
        alerts = []
        cursor = 0
        pattern = 'anomaly:latest:*'

        while True:
            cursor, keys = self.redis.scan(cursor=cursor, match=pattern, count=100)
            for key in keys:
                data = self.redis.get(key)
                if data:
                    alert = json.loads(data)
                    if severity is None or alert.get('severity') == severity:
                        alerts.append(alert)
            if cursor == 0:
                break

        return alerts[-50:]
    
    def get_stats(self) -> Dict:
        """Get anomaly detection statistics"""
        history = self.get_anomaly_history()
        total_anomalies = len(history)
        if total_anomalies == 0:
            return {
                'total_anomalies': 0,
                'by_type': {},
                'by_severity': {},
                'last_anomaly': None
            }
        
        # Count by type
        by_type = {}
        for anomaly in history:
            data_type = anomaly.get('data_type', 'unknown')
            by_type[data_type] = by_type.get(data_type, 0) + 1
        
        # Count by severity
        by_severity = {}
        for anomaly in history:
            severity = anomaly.get('severity', 'unknown')
            by_severity[severity] = by_severity.get(severity, 0) + 1
        
        return {
            'total_anomalies': total_anomalies,
            'by_type': by_type,
            'by_severity': by_severity,
            'last_anomaly': history[-1] if history else None
        }