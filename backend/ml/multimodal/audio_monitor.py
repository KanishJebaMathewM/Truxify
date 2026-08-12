import librosa
import numpy as np
import tensorflow as tf
from tensorflow import keras
import sounddevice as sd
import soundfile as sf
import redis
import json
import logging
from datetime import datetime
from typing import Dict, List, Tuple, Any
import noisereduce as nr

logger = logging.getLogger(__name__)

class AudioMonitor:
    """Audio Analysis for Driver Safety"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
        # Audio parameters
        self.sample_rate = 16000
        self.duration = 2  # seconds
        self.channels = 1
        
        # Load models
        self.emergency_sound_model = self._load_emergency_model()
        self.honk_detection_model = self._load_honk_model()
        self.speech_emotion_model = self._load_emotion_model()
        
        # State tracking
        self.emergency_count = 0
        self.honk_count = 0
        self.last_alert = None
        
        # Emergency sound classes
        self.emergency_classes = ['honk', 'siren', 'crash', 'screaming', 'normal']
        
        logger.info("✅ Audio Monitor initialized")
    
    def _load_emergency_model(self):
        """Load emergency sound detection model"""
        model = keras.Sequential([
            keras.layers.Conv1D(64, 3, activation='relu', input_shape=(3000, 1)),
            keras.layers.MaxPooling1D(2),
            keras.layers.Conv1D(128, 3, activation='relu'),
            keras.layers.MaxPooling1D(2),
            keras.layers.Conv1D(256, 3, activation='relu'),
            keras.layers.GlobalAveragePooling1D(),
            keras.layers.Dense(128, activation='relu'),
            keras.layers.Dropout(0.5),
            keras.layers.Dense(5, activation='softmax')
        ])
        model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
        return model
    
    def _load_honk_model(self):
        """Load honk detection model"""
        return self._load_emergency_model()
    
    def _load_emotion_model(self):
        """Load speech emotion recognition model"""
        model = keras.Sequential([
            keras.layers.Conv1D(64, 3, activation='relu', input_shape=(3000, 1)),
            keras.layers.MaxPooling1D(2),
            keras.layers.Conv1D(128, 3, activation='relu'),
            keras.layers.MaxPooling1D(2),
            keras.layers.Flatten(),
            keras.layers.Dense(128, activation='relu'),
            keras.layers.Dropout(0.5),
            keras.layers.Dense(6, activation='softmax')  # 6 emotions
        ])
        model.compile(optimizer='adam', loss='categorical_crossentropy', metrics=['accuracy'])
        return model
    
    def extract_features(self, audio_data: np.ndarray) -> np.ndarray:
        """Extract audio features"""
        # Mel-spectrogram
        mel_spec = librosa.feature.melspectrogram(
            y=audio_data,
            sr=self.sample_rate,
            n_mels=128,
            fmax=8000
        )
        mel_spec_db = librosa.power_to_db(mel_spec, ref=np.max)
        
        # MFCC
        mfcc = librosa.feature.mfcc(
            y=audio_data,
            sr=self.sample_rate,
            n_mfcc=13
        )
        
        # Chroma features
        chroma = librosa.feature.chroma_stft(
            y=audio_data,
            sr=self.sample_rate
        )
        
        # Combine features
        features = np.concatenate([
            mel_spec_db.flatten()[:1000],
            mfcc.flatten()[:1000],
            chroma.flatten()[:1000]
        ])
        
        return features
    
    def detect_emergency_sounds(self, audio_data: np.ndarray) -> Dict:
        """Detect emergency sounds"""
        try:
            # Preprocess audio
            audio_clean = nr.reduce_noise(y=audio_data, sr=self.sample_rate)
            
            # Extract features
            features = self.extract_features(audio_clean)
            features = features.reshape(1, -1, 1)
            
            # Predict
            predictions = self.emergency_sound_model.predict(features, verbose=0)
            class_idx = np.argmax(predictions[0])
            confidence = np.max(predictions[0])
            
            detected_class = self.emergency_classes[class_idx]
            is_emergency = detected_class != 'normal'
            
            if is_emergency:
                self.emergency_count += 1
            else:
                self.emergency_count = 0
            
            return {
                'detected': detected_class,
                'confidence': float(confidence),
                'is_emergency': is_emergency,
                'emergency_count': self.emergency_count,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Emergency sound detection failed: {e}")
            return {'detected': 'error', 'confidence': 0, 'is_emergency': False}
    
    def detect_honk(self, audio_data: np.ndarray) -> Dict:
        """Detect honking"""
        try:
            # Extract features
            features = self.extract_features(audio_data)
            features = features.reshape(1, -1, 1)
            
            # Predict
            predictions = self.honk_detection_model.predict(features, verbose=0)
            confidence = np.max(predictions[0])
            is_honk = confidence > 0.7
            
            if is_honk:
                self.honk_count += 1
            else:
                self.honk_count = 0
            
            return {
                'is_honk': is_honk,
                'confidence': float(confidence),
                'honk_count': self.honk_count,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Honk detection failed: {e}")
            return {'is_honk': False, 'confidence': 0}
    
    def analyze_speech_emotion(self, audio_data: np.ndarray) -> Dict:
        """Analyze driver speech emotion"""
        try:
            # Extract features
            features = self.extract_features(audio_data)
            features = features.reshape(1, -1, 1)
            
            # Predict
            predictions = self.speech_emotion_model.predict(features, verbose=0)
            emotions = ['neutral', 'happy', 'sad', 'angry', 'fearful', 'surprised']
            class_idx = np.argmax(predictions[0])
            
            return {
                'emotion': emotions[class_idx],
                'confidence': float(np.max(predictions[0])),
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Speech emotion analysis failed: {e}")
            return {'emotion': 'unknown', 'confidence': 0}
    
    def record_audio(self, duration: int = None) -> np.ndarray:
        """Record audio from microphone"""
        if duration is None:
            duration = self.duration
        
        try:
            recording = sd.rec(
                int(duration * self.sample_rate),
                samplerate=self.sample_rate,
                channels=self.channels,
                dtype='float32'
            )
            sd.wait()
            return recording.flatten()
        except Exception as e:
            logger.error(f"Audio recording failed: {e}")
            return np.zeros(self.sample_rate * duration)
    
    def process_audio(self, audio_data: np.ndarray) -> Dict:
        """Process audio data"""
        try:
            # Detect emergency sounds
            emergency = self.detect_emergency_sounds(audio_data)
            
            # Detect honk
            honk = self.detect_honk(audio_data)
            
            # Analyze speech emotion (if speech present)
            emotion = self.analyze_speech_emotion(audio_data)
            
            # Determine alert level
            alert_level = 'SAFE'
            alert_message = 'Normal audio'
            
            if emergency['is_emergency']:
                alert_level = 'CRITICAL'
                alert_message = f"⚠️ Emergency sound detected: {emergency['detected']}"
            elif honk['is_honk'] and honk['honk_count'] > 3:
                alert_level = 'WARNING'
                alert_message = '⚠️ Excessive honking detected'
            
            result = {
                'emergency': emergency,
                'honk': honk,
                'emotion': emotion,
                'alert_level': alert_level,
                'alert_message': alert_message,
                'timestamp': datetime.now().isoformat()
            }
            
            # Store in Redis
            self.redis.setex(
                'audio:latest',
                60,
                json.dumps(result)
            )
            
            return result
            
        except Exception as e:
            logger.error(f"Audio processing failed: {e}")
            return {'status': 'ERROR', 'error': str(e)}
    
    def get_alert(self, result: Dict) -> Dict:
        """Generate audio safety alert"""
        if result['alert_level'] == 'CRITICAL':
            return {
                'level': 'CRITICAL',
                'message': result['alert_message'],
                'actions': ['Alert driver', 'Notify emergency services', 'Record incident'],
                'timestamp': datetime.now().isoformat()
            }
        elif result['alert_level'] == 'WARNING':
            return {
                'level': 'WARNING',
                'message': result['alert_message'],
                'actions': ['Monitor driver', 'Check surroundings'],
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'level': 'SAFE',
                'message': '✅ No emergency sounds detected',
                'actions': ['Continue monitoring'],
                'timestamp': datetime.now().isoformat()
            }