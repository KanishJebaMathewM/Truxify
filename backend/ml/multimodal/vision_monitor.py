import cv2
import numpy as np
import tensorflow as tf
from tensorflow import keras
from tensorflow.keras import layers
import mediapipe as mp
import dlib
from scipy.spatial import distance as dist
import logging
import redis
import json
from datetime import datetime
import base64
from typing import Dict, List, Tuple, Any

logger = logging.getLogger(__name__)

class VisionMonitor:
    """Computer Vision for Driver Safety Monitoring"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
        # Initialize MediaPipe
        self.mp_face_mesh = mp.solutions.face_mesh
        self.mp_drawing = mp.solutions.drawing_utils
        self.face_mesh = self.mp_face_mesh.FaceMesh(
            static_image_mode=False,
            max_num_faces=1,
            refine_landmarks=True,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5
        )
        
        # Initialize dlib for facial landmarks
        self.detector = dlib.get_frontal_face_detector()
        self.predictor = dlib.shape_predictor('models/shape_predictor_68_face_landmarks.dat')
        
        # Load models
        self.drowsiness_model = self._load_drowsiness_model()
        self.distraction_model = self._load_distraction_model()
        self.face_detection_model = self._load_face_detection_model()
        
        # State tracking
        self.eye_closed_frames = 0
        self.distraction_frames = 0
        self.safety_thresholds = {
            'eye_aspect_ratio': 0.25,
            'drowsiness_frames': 20,
            'distraction_frames': 30,
            'head_pose_threshold': 30  # degrees
        }
        
        logger.info("✅ Vision Monitor initialized")
    
    def _load_drowsiness_model(self):
        """Load drowsiness detection model"""
        # In production: load pre-trained model
        model = keras.Sequential([
            layers.Conv2D(32, (3, 3), activation='relu', input_shape=(64, 64, 3)),
            layers.MaxPooling2D(2, 2),
            layers.Conv2D(64, (3, 3), activation='relu'),
            layers.MaxPooling2D(2, 2),
            layers.Conv2D(128, (3, 3), activation='relu'),
            layers.MaxPooling2D(2, 2),
            layers.Flatten(),
            layers.Dense(128, activation='relu'),
            layers.Dropout(0.5),
            layers.Dense(1, activation='sigmoid')
        ])
        model.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
        return model
    
    def _load_distraction_model(self):
        """Load distraction detection model"""
        return tf.keras.models.Sequential([
            tf.keras.layers.Conv2D(32, (3, 3), activation='relu', input_shape=(64, 64, 3)),
            tf.keras.layers.MaxPooling2D(2, 2),
            tf.keras.layers.Conv2D(64, (3, 3), activation='relu'),
            tf.keras.layers.MaxPooling2D(2, 2),
            tf.keras.layers.Flatten(),
            tf.keras.layers.Dense(128, activation='relu'),
            tf.keras.layers.Dropout(0.5),
            tf.keras.layers.Dense(5, activation='softmax')  # 5 distraction classes
        ])
    
    def _load_face_detection_model(self):
        """Load face detection model"""
        return cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
    
    def eye_aspect_ratio(self, eye_landmarks) -> float:
        """Calculate Eye Aspect Ratio (EAR)"""
        # Compute Euclidean distances
        A = dist.euclidean(eye_landmarks[1], eye_landmarks[5])
        B = dist.euclidean(eye_landmarks[2], eye_landmarks[4])
        C = dist.euclidean(eye_landmarks[0], eye_landmarks[3])
        ear = (A + B) / (2.0 * C)
        return ear
    
    def detect_drowsiness(self, face_landmarks) -> Dict:
        """Detect driver drowsiness"""
        try:
            # Extract eye landmarks
            left_eye_indices = [33, 160, 158, 133, 153, 144]
            right_eye_indices = [362, 385, 387, 263, 373, 380]
            
            left_eye = [face_landmarks[i] for i in left_eye_indices]
            right_eye = [face_landmarks[i] for i in right_eye_indices]
            
            # Calculate EAR for both eyes
            left_ear = self.eye_aspect_ratio(left_eye)
            right_ear = self.eye_aspect_ratio(right_eye)
            avg_ear = (left_ear + right_ear) / 2.0
            
            # Detect closed eyes
            is_closed = avg_ear < self.safety_thresholds['eye_aspect_ratio']
            
            # Track closed frames
            if is_closed:
                self.eye_closed_frames += 1
            else:
                self.eye_closed_frames = 0
            
            # Determine drowsiness level
            if self.eye_closed_frames > self.safety_thresholds['drowsiness_frames']:
                status = 'DROWSY'
                confidence = min(1.0, self.eye_closed_frames / 50)
            elif self.eye_closed_frames > 10:
                status = 'SLEEPY'
                confidence = 0.6
            else:
                status = 'AWAKE'
                confidence = 0.9
            
            return {
                'status': status,
                'confidence': confidence,
                'ear': avg_ear,
                'closed_frames': self.eye_closed_frames,
                'is_closed': is_closed,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Drowsiness detection failed: {e}")
            return {'status': 'UNKNOWN', 'confidence': 0}
    
    def detect_distraction(self, face_landmarks) -> Dict:
        """Detect driver distraction"""
        try:
            # Head pose estimation
            head_pose = self._estimate_head_pose(face_landmarks)
            
            # Check if driver is looking away
            is_distracted = (
                abs(head_pose['yaw']) > self.safety_thresholds['head_pose_threshold'] or
                abs(head_pose['pitch']) > self.safety_thresholds['head_pose_threshold']
            )
            
            if is_distracted:
                self.distraction_frames += 1
            else:
                self.distraction_frames = 0
            
            if self.distraction_frames > self.safety_thresholds['distraction_frames']:
                status = 'DISTRACTED'
                confidence = min(1.0, self.distraction_frames / 60)
            else:
                status = 'FOCUSED'
                confidence = 0.9
            
            return {
                'status': status,
                'confidence': confidence,
                'head_pose': head_pose,
                'is_distracted': is_distracted,
                'frames': self.distraction_frames,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Distraction detection failed: {e}")
            return {'status': 'UNKNOWN', 'confidence': 0}
    
    def _estimate_head_pose(self, landmarks) -> Dict:
        """Estimate head pose from facial landmarks"""
        # Simplified head pose estimation
        # In production: use solvePnP with 3D model
        return {
            'yaw': np.random.uniform(-30, 30),
            'pitch': np.random.uniform(-20, 20),
            'roll': np.random.uniform(-10, 10)
        }
    
    def process_frame(self, frame) -> Dict:
        """Process single video frame"""
        try:
            # Convert to RGB
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Detect face
            results = self.face_mesh.process(rgb_frame)
            
            if results.multi_face_landmarks:
                landmarks = results.multi_face_landmarks[0]
                
                # Get landmark coordinates
                h, w = frame.shape[:2]
                face_landmarks = []
                for landmark in landmarks.landmark:
                    x = int(landmark.x * w)
                    y = int(landmark.y * h)
                    face_landmarks.append((x, y))
                
                # Detect drowsiness
                drowsiness = self.detect_drowsiness(face_landmarks)
                
                # Detect distraction
                distraction = self.detect_distraction(face_landmarks)
                
                # Combine results
                result = {
                    'drowsiness': drowsiness,
                    'distraction': distraction,
                    'overall_status': self._determine_overall_status(drowsiness, distraction),
                    'timestamp': datetime.now().isoformat()
                }
                
                # Store in Redis
                self.redis.setex(
                    'vision:latest',
                    60,
                    json.dumps(result)
                )
                
                return result
            
            return {'status': 'NO_FACE_DETECTED'}
            
        except Exception as e:
            logger.error(f"Frame processing failed: {e}")
            return {'status': 'ERROR', 'error': str(e)}
    
    def _determine_overall_status(self, drowsiness: Dict, distraction: Dict) -> str:
        """Determine overall safety status"""
        if drowsiness['status'] == 'DROWSY' or distraction['status'] == 'DISTRACTED':
            return 'CRITICAL'
        elif drowsiness['status'] == 'SLEEPY':
            return 'WARNING'
        elif drowsiness['status'] == 'AWAKE' and distraction['status'] == 'FOCUSED':
            return 'SAFE'
        else:
            return 'UNKNOWN'
    
    def get_alert(self, result: Dict) -> Dict:
        """Generate safety alert"""
        if result['overall_status'] == 'CRITICAL':
            return {
                'level': 'CRITICAL',
                'message': '⚠️ Driver is drowsy or distracted! Immediate action required.',
                'actions': ['Sound alarm', 'Notify fleet manager', 'Suggest break'],
                'timestamp': datetime.now().isoformat()
            }
        elif result['overall_status'] == 'WARNING':
            return {
                'level': 'WARNING',
                'message': '⚠️ Driver showing signs of fatigue. Please be careful.',
                'actions': ['Monitor closely', 'Suggest rest stop'],
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'level': 'SAFE',
                'message': '✅ Driver is alert and focused.',
                'actions': ['Continue monitoring'],
                'timestamp': datetime.now().isoformat()
            }