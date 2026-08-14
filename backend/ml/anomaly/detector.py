import numpy as np
import pandas as pd
import redis
import json
import logging
from collections import deque
from datetime import datetime
from typing import Dict, List, Any, Optional
from .models import LSTMAutoencoder
from sklearn.preprocessing import StandardScaler

logger = logging.getLogger(__name__)

class AnomalyDetector:
    """Real-time Anomaly Detection Service"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
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
    
    def train_models(self, data: Dict[str, np.ndarray], epochs: int = 50):
        """Train all models"""
        results = {}
        
        for name, X_train in data.items():
            if name in self.models:
                logger.info(f"Training {name} model...")
                
                # Scale data
                scaler = StandardScaler()
                X_scaled = scaler.fit_transform(X_train.reshape(-1, X_train.shape[-1]))
                X_scaled = X_scaled.reshape(X_train.shape)
                
                # Save scaler
                self.scalers[name] = scaler
                
                # Train model
                history = self.models[name].train(X_scaled, epochs=epochs)
                results[name] = {
                    'loss': history.history['loss'][-1],
                    'val_loss': history.history.get('val_loss', [0])[-1]
                }
                
                # Save model
                self.models[name].save(f"models/anomaly_{name}")
        
        return results
    
    def detect_anomaly(self, data_type: str, data: np.ndarray, entity_key: str = None) -> Dict:
        """Detect anomalies in real-time data"""
        try:
            if data_type not in self.models:
                return {'error': f'Unknown data type: {data_type}'}
            
            model = self.models[data_type]
            
            # Reshape if needed
            if len(data.shape) == 1:
                data = data.reshape(1, -1)
            
            # Scale data
            if data_type in self.scalers:
                scaler = self.scalers[data_type]
                data_scaled = scaler.transform(data)
            else:
                data_scaled = data

            # Build a genuine rolling window for this entity (padded at the
            # front by repeating the earliest observation during warm-up)
            # instead of tiling the single timestep (issue #11669).
            buffer = self._get_feature_buffer(data_type, entity_key)
            buffer.append(data_scaled[0])

            seq = list(buffer)
            seq_len = model.sequence_length
            if len(seq) < seq_len:
                seq = [seq[0]] * (seq_len - len(seq)) + seq
            window = np.array(seq, dtype=np.float32)

            # Get anomaly score
            result = model.get_anomaly_score(window)
            
            # Determine severity
            score = result['anomaly_score']
            if score >= self.alert_thresholds['high']:
                severity = 'CRITICAL'
            elif score >= self.alert_thresholds['medium']:
                severity = 'WARNING'
            elif score >= self.alert_thresholds['low']:
                severity = 'INFO'
            else:
                severity = 'NORMAL'
            
            # Add metadata
            result.update({
                'data_type': data_type,
                'severity': severity,
                'timestamp': datetime.now().isoformat(),
                'data': data.tolist() if isinstance(data, np.ndarray) else data
            })
            
            # Store anomaly history
            if result['is_anomaly']:
                self.anomaly_history.append(result)
                
                # Store in Redis
                self.redis.setex(
                    f'anomaly:latest:{data_type}',
                    3600,
                    json.dumps(result)
                )
                
                # Push to alerts channel
                self.redis.publish(
                    'anomaly:alerts',
                    json.dumps({
                        'type': data_type,
                        'severity': severity,
                        'data': result,
                        'timestamp': datetime.now().isoformat()
                    })
                )
            
            return result
            
        except Exception as e:
            logger.error(f"Anomaly detection failed: {e}")
            return {'error': str(e)}
    
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
            
            # Detect anomaly (window keyed per transaction)
            result = self.detect_anomaly(
                'transactions',
                features,
                entity_key=str(transaction.get('transaction_id') or '')
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
        if data_type:
            return [h for h in self.anomaly_history if h.get('data_type') == data_type]
        return list(self.anomaly_history)
    
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
        total_anomalies = len(self.anomaly_history)
        if total_anomalies == 0:
            return {
                'total_anomalies': 0,
                'by_type': {},
                'by_severity': {},
                'last_anomaly': None
            }
        
        # Count by type
        by_type = {}
        for anomaly in self.anomaly_history:
            data_type = anomaly.get('data_type', 'unknown')
            by_type[data_type] = by_type.get(data_type, 0) + 1
        
        # Count by severity
        by_severity = {}
        for anomaly in self.anomaly_history:
            severity = anomaly.get('severity', 'unknown')
            by_severity[severity] = by_severity.get(severity, 0) + 1
        
        return {
            'total_anomalies': total_anomalies,
            'by_type': by_type,
            'by_severity': by_severity,
            'last_anomaly': self.anomaly_history[-1] if self.anomaly_history else None
        }