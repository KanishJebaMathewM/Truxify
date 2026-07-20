import json
import logging
from datetime import datetime
from typing import Dict, List, Any
import redis
import numpy as np

logger = logging.getLogger(__name__)

class SensorFusion:
    """Sensor Fusion for Multi-Modal Driver Safety"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
        # Fusion weights
        self.weights = {
            'vision': 0.5,
            'audio': 0.3,
            'sensors': 0.2
        }
        
        # Alert thresholds
        self.thresholds = {
            'critical': 0.8,
            'warning': 0.5,
            'safe': 0.2
        }
        
        # Sensor data cache
        self.sensor_cache = {}
        
        logger.info("✅ Sensor Fusion initialized")
    
    def fuse_data(self, vision_data: Dict, audio_data: Dict, sensor_data: Dict) -> Dict:
        """Fuse data from all modalities"""
        try:
            # Calculate individual risk scores
            vision_risk = self._calculate_vision_risk(vision_data)
            audio_risk = self._calculate_audio_risk(audio_data)
            sensor_risk = self._calculate_sensor_risk(sensor_data)
            
            # Weighted fusion
            fused_risk = (
                vision_risk * self.weights['vision'] +
                audio_risk * self.weights['audio'] +
                sensor_risk * self.weights['sensors']
            )
            
            # Determine alert level
            if fused_risk > self.thresholds['critical']:
                alert_level = 'CRITICAL'
                alert_message = '⚠️ High risk detected! Immediate action required.'
            elif fused_risk > self.thresholds['warning']:
                alert_level = 'WARNING'
                alert_message = '⚠️ Moderate risk detected. Please be careful.'
            else:
                alert_level = 'SAFE'
                alert_message = '✅ Driver is safe.'
            
            # Generate detailed report
            report = {
                'fusion_risk': float(fused_risk),
                'vision_risk': float(vision_risk),
                'audio_risk': float(audio_risk),
                'sensor_risk': float(sensor_risk),
                'alert_level': alert_level,
                'alert_message': alert_message,
                'components': {
                    'vision': vision_data,
                    'audio': audio_data,
                    'sensors': sensor_data
                },
                'timestamp': datetime.now().isoformat()
            }
            
            # Store in Redis
            self.redis.setex(
                'fusion:latest',
                60,
                json.dumps(report)
            )
            
            return report
            
        except Exception as e:
            logger.error(f"Sensor fusion failed: {e}")
            return {
                'fusion_risk': 0.5,
                'alert_level': 'UNKNOWN',
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    def _calculate_vision_risk(self, vision_data: Dict) -> float:
        """Calculate risk from vision data"""
        risk = 0.0
        
        # Drowsiness risk
        if vision_data.get('drowsiness'):
            drowsiness = vision_data['drowsiness']
            if drowsiness.get('status') == 'DROWSY':
                risk += 0.4
            elif drowsiness.get('status') == 'SLEEPY':
                risk += 0.2
        
        # Distraction risk
        if vision_data.get('distraction'):
            distraction = vision_data['distraction']
            if distraction.get('status') == 'DISTRACTED':
                risk += 0.3
        
        return min(risk, 1.0)
    
    def _calculate_audio_risk(self, audio_data: Dict) -> float:
        """Calculate risk from audio data"""
        risk = 0.0
        
        # Emergency sound risk
        if audio_data.get('emergency'):
            emergency = audio_data['emergency']
            if emergency.get('is_emergency'):
                risk += 0.4
        
        # Honk risk
        if audio_data.get('honk'):
            honk = audio_data['honk']
            if honk.get('is_honk') and honk.get('honk_count', 0) > 3:
                risk += 0.2
        
        # Emotion risk
        if audio_data.get('emotion'):
            emotion = audio_data['emotion']
            if emotion.get('emotion') in ['angry', 'fearful']:
                risk += 0.2
        
        return min(risk, 1.0)
    
    def _calculate_sensor_risk(self, sensor_data: Dict) -> float:
        """Calculate risk from IoT sensor data"""
        risk = 0.0
        
        # Speed risk
        if sensor_data.get('speed', 0) > 80:
            risk += 0.2
        
        # Acceleration risk (hard braking/acceleration)
        if abs(sensor_data.get('acceleration', 0)) > 5:
            risk += 0.2
        
        # Steering risk (rapid steering changes)
        if abs(sensor_data.get('steering_angle', 0)) > 30:
            risk += 0.1
        
        # Seatbelt risk
        if not sensor_data.get('seatbelt', True):
            risk += 0.3
        
        return min(risk, 1.0)
    
    def get_safety_report(self) -> Dict:
        """Get latest safety report"""
        # Get latest data from all modalities
        vision_data = self.redis.get('vision:latest')
        audio_data = self.redis.get('audio:latest')
        
        vision = json.loads(vision_data) if vision_data else {}
        audio = json.loads(audio_data) if audio_data else {}
        
        # Simulate sensor data (in production: read from IoT devices)
        sensor = {
            'speed': np.random.uniform(40, 90),
            'acceleration': np.random.uniform(-8, 8),
            'steering_angle': np.random.uniform(-45, 45),
            'seatbelt': np.random.choice([True, False], p=[0.95, 0.05]),
            'timestamp': datetime.now().isoformat()
        }
        
        # Fuse data
        result = self.fuse_data(vision, audio, sensor)
        
        # Generate actions
        actions = self._generate_actions(result)
        result['actions'] = actions
        
        return result
    
    def _generate_actions(self, report: Dict) -> List[str]:
        """Generate recommended actions"""
        actions = []
        
        if report['alert_level'] == 'CRITICAL':
            actions = [
                '🚨 Sound alarm immediately',
                '📱 Notify fleet manager',
                '🚔 Contact emergency services if needed',
                '📹 Record video for incident analysis',
                '⏸️ Suggest immediate break'
            ]
        elif report['alert_level'] == 'WARNING':
            actions = [
                '📢 Alert driver with voice warning',
                '📊 Monitor driver closely',
                '🔄 Suggest rest stop',
                '📝 Log incident for review'
            ]
        else:
            actions = [
                '✅ Continue monitoring',
                '📊 Record safety metrics',
                '📈 Update safety score'
            ]
        
        return actions
    
    def get_stats(self) -> Dict:
        """Get fusion statistics"""
        raw = self.redis.get('fusion:latest')
        stats = {
            'last_fusion': json.loads(raw) if raw else None,
            'vision_count': len(self.redis.keys('vision:*')),
            'audio_count': len(self.redis.keys('audio:*')),
            'timestamp': datetime.now().isoformat()
        }
        
        return stats