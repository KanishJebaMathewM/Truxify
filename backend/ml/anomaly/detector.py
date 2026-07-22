import numpy as np
import pandas as pd
import redis
import json
import logging
from datetime import datetime
from typing import Dict, List, Any, Optional
from models import LSTMAutoencoder
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
        
        self.anomaly_history = []
        self.max_history = 1000
        
        logger.info("✅ Anomaly Detector initialized")
    
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
    
    def detect_anomaly(self, data_type: str, data: np.ndarray) -> Dict:
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
            
            # Get anomaly score
            result = model.get_anomaly_score(data_scaled)
            
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
                if len(self.anomaly_history) > self.max_history:
                    self.anomaly_history = self.anomaly_history[-self.max_history:]
                
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
            
            # Detect anomaly
            result = self.detect_anomaly('driver_behavior', features)
            
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
            
            # Detect anomaly
            result = self.detect_anomaly('transactions', features)
            
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
            
            # Detect anomaly
            result = self.detect_anomaly('gps_tracking', features)
            
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
        return self.anomaly_history
    
    def get_alerts(self, severity: Optional[str] = None) -> List[Dict]:
        """Get recent alerts"""
        alerts = []
        keys = self.redis.keys('anomaly:alert:*')
        
        for key in keys[-50:]:  # Last 50 alerts
            data = self.redis.get(key)
            if data:
                alert = json.loads(data)
                if severity is None or alert.get('severity') == severity:
                    alerts.append(alert)
        
        return alerts
    
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