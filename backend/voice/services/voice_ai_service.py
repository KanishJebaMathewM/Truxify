import os
import json
import asyncio
import logging
from typing import Dict, List, Optional, Tuple
from datetime import datetime
import whisper
import torch
from transformers import AutoTokenizer, AutoModelForSeq2SeqLM
import speech_recognition as sr
from googletrans import Translator
import redis
import numpy as np
import soundfile as sf
import io
from elevenlabs import generate, play, set_api_key

logger = logging.getLogger(__name__)

class VoiceAIService:
    """Multi-language Voice AI with regional dialect support"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
        # Load Whisper model for Indian languages
        self.whisper_model = whisper.load_model("medium")
        
        # Language mapping for Indian languages
        self.languages = {
            'hi': {'name': 'Hindi', 'code': 'hi', 'dialects': ['hindi', 'haryanvi', 'bhojpuri']},
            'ta': {'name': 'Tamil', 'code': 'ta', 'dialects': ['tamil', 'kongu', 'madras']},
            'te': {'name': 'Telugu', 'code': 'te', 'dialects': ['telugu', 'rayalaseema']},
            'bn': {'name': 'Bengali', 'code': 'bn', 'dialects': ['bengali', 'sylheti']},
            'kn': {'name': 'Kannada', 'code': 'kn', 'dialects': ['kannada', 'mangalore']},
            'ml': {'name': 'Malayalam', 'code': 'ml', 'dialects': ['malayalam']},
            'mr': {'name': 'Marathi', 'code': 'mr', 'dialects': ['marathi', 'varhadi']},
            'gu': {'name': 'Gujarati', 'code': 'gu', 'dialects': ['gujarati']},
            'pa': {'name': 'Punjabi', 'code': 'pa', 'dialects': ['punjabi', 'doabi']},
            'or': {'name': 'Odia', 'code': 'or', 'dialects': ['odia']},
            'as': {'name': 'Assamese', 'code': 'as', 'dialects': ['assamese']},
            'mai': {'name': 'Maithili', 'code': 'mai', 'dialects': ['maithili']},
            'sat': {'name': 'Santali', 'code': 'sat', 'dialects': ['santali']},
            'kok': {'name': 'Konkani', 'code': 'kok', 'dialects': ['konkani']},
            'ur': {'name': 'Urdu', 'code': 'ur', 'dialects': ['urdu', 'deccani']}
        }
        
        self.supported_languages = list(self.languages.keys())
        self.supported_dialects = []
        for lang in self.languages.values():
            self.supported_dialects.extend(lang['dialects'])
        
        # Initialize translator
        self.translator = Translator()
        
        # ElevenLabs for TTS
        elevenlabs_key = os.getenv('ELEVENLABS_API_KEY')
        if elevenlabs_key:
            set_api_key(elevenlabs_key)
        
        # Voice profiles for different languages
        self.voice_profiles = {
            'hi': 'Hindi Female',
            'ta': 'Tamil Female',
            'te': 'Telugu Female',
            'bn': 'Bengali Female',
            'en': 'English Female'
        }
        
        logger.info(f"✅ Voice AI Service initialized with {len(self.languages)} languages")
    
    async def detect_language(self, audio_data: bytes) -> Dict:
        """Detect language from speech with dialect recognition"""
        try:
            # Convert audio bytes to numpy array
            audio_np = self._bytes_to_numpy(audio_data)
            
            # Whisper transcribe to detect language
            result = self.whisper_model.transcribe(
                audio_np,
                task="transcribe",
                fp16=False
            )
            
            detected_lang = result.get('language', 'hi')
            text = result.get('text', '')
            confidence = result.get('confidence', 0.7)
            
            # Fine-tune dialect detection
            dialect = self._detect_dialect(text, detected_lang)
            
            # Store in Redis for caching
            self.redis.setex(
                f"voice:detect:{hash(audio_data)}",
                3600,
                json.dumps({
                    'language': detected_lang,
                    'dialect': dialect,
                    'confidence': confidence,
                    'text': text
                })
            )
            
            return {
                'language_code': detected_lang,
                'language_name': self.languages.get(detected_lang, {}).get('name', 'Unknown'),
                'dialect': dialect,
                'confidence': confidence,
                'text': text,
                'is_supported': detected_lang in self.supported_languages
            }
            
        except Exception as e:
            logger.error(f"Language detection failed: {e}")
            return {
                'language_code': 'hi',
                'language_name': 'Hindi',
                'dialect': 'hindi',
                'confidence': 0.5,
                'text': '',
                'is_supported': True,
                'error': str(e)
            }
    
    def _detect_dialect(self, text: str, language_code: str) -> str:
        """Detect regional dialect from text"""
        dialect_keywords = {
            'haryanvi': ['करिया', 'म्हारा', 'तेरा', 'मेरा'],
            'bhojpuri': ['हम', 'तोहर', 'रउरा', 'बा'],
            'kongu': ['இங்க', 'அங்க', 'வாங்க', 'போங்க'],
            'madras': ['டா', 'டி', 'மச்சி', 'இல்ல'],
            'rayalaseema': ['అండి', 'అండే', 'పోండి'],
            'mangalore': ['ಂಡ', 'ಂಧ', 'ಯಾವ್'],
            'varhadi': ['का', 'चा', 'होत', 'असत'],
            'doabi': ['ਆ', 'ਈ', 'ਓ', 'ਨੇ'],
            'deccani': ['मैं', 'तू', 'ये', 'वो']
        }
        
        # Check for dialect keywords
        for dialect, keywords in dialect_keywords.items():
            for keyword in keywords:
                if keyword in text:
                    return dialect
        
        # Default dialect based on language
        lang_dialects = self.languages.get(language_code, {})
        return lang_dialects.get('dialects', ['hindi'])[0]
    
    def _bytes_to_numpy(self, audio_bytes: bytes) -> np.ndarray:
        """Convert audio bytes to numpy array"""
        # Simple conversion - in production use proper audio processing
        audio_data = np.frombuffer(audio_bytes, dtype=np.int16).astype(np.float32)
        audio_data = audio_data / 32768.0
        return audio_data
    
    async def transcribe_speech(self, audio_data: bytes, language_code: str = None) -> Dict:
        """Transcribe speech with regional dialect support"""
        try:
            # Detect language if not provided
            if not language_code:
                detection = await self.detect_language(audio_data)
                language_code = detection['language_code']
                dialect = detection['dialect']
            else:
                dialect = self._detect_dialect('', language_code)
            
            # Convert audio
            audio_np = self._bytes_to_numpy(audio_data)
            
            # Transcribe with Whisper
            result = self.whisper_model.transcribe(
                audio_np,
                language=language_code,
                task="transcribe",
                fp16=False
            )
            
            text = result.get('text', '')
            confidence = result.get('confidence', 0.7)
            
            # Adapt text for dialect
            adapted_text = self._adapt_dialect(text, dialect)
            
            # Translate to English if needed (for processing)
            english_text = self.translator.translate(adapted_text, dest='en').text
            
            # Store in Redis
            self.redis.setex(
                f"voice:transcribe:{hash(audio_data)}",
                3600,
                json.dumps({
                    'text': adapted_text,
                    'confidence': confidence,
                    'language': language_code,
                    'dialect': dialect,
                    'english': english_text
                })
            )
            
            return {
                'text': adapted_text,
                'confidence': confidence,
                'language_code': language_code,
                'language_name': self.languages.get(language_code, {}).get('name', 'Unknown'),
                'dialect': dialect,
                'english_translation': english_text,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Speech transcription failed: {e}")
            return {
                'text': '',
                'confidence': 0,
                'language_code': language_code or 'hi',
                'language_name': 'Hindi',
                'dialect': 'hindi',
                'english_translation': '',
                'error': str(e)
            }
    
    def _adapt_dialect(self, text: str, dialect: str) -> str:
        """Adapt text to standard language form"""
        dialect_adaptations = {
            'haryanvi': {
                'करिया': 'करना',
                'म्हारा': 'मेरा',
                'तेरा': 'तुम्हारा'
            },
            'bhojpuri': {
                'हम': 'मैं',
                'तोहर': 'तुम्हारा',
                'रउरा': 'आपका'
            }
        }
        
        if dialect in dialect_adaptations:
            for old, new in dialect_adaptations[dialect].items():
                text = text.replace(old, new)
        
        return text
    
    async def generate_speech(self, text: str, language_code: str = 'hi', 
                              voice_profile: str = None) -> bytes:
        """Generate speech in multiple languages"""
        try:
            # Translate text to target language if needed
            if language_code != 'en':
                translated = self.translator.translate(text, dest=language_code)
                text = translated.text
            
            # Choose voice profile
            if not voice_profile:
                voice_profile = self.voice_profiles.get(language_code, 'English Female')
            
            # Generate audio with ElevenLabs
            audio = generate(
                text=text,
                voice=voice_profile,
                model="eleven_monolingual_v1"
            )
            
            # Cache in Redis
            cache_key = f"voice:tts:{hash(text)}:{language_code}"
            self.redis.setex(cache_key, 3600, json.dumps({
                'audio': audio,
                'timestamp': datetime.now().isoformat()
            }))
            
            return audio
            
        except Exception as e:
            logger.error(f"Speech generation failed: {e}")
            # Fallback to basic TTS
            return self._fallback_tts(text)
    
    def _fallback_tts(self, text: str) -> bytes:
        """Fallback TTS using gTTS"""
        try:
            from gtts import gTTS
            tts = gTTS(text=text, lang='hi', slow=False)
            audio_bytes = io.BytesIO()
            tts.write_to_fp(audio_bytes)
            return audio_bytes.getvalue()
        except:
            return b''
    
    async def process_voice_command(self, audio_data: bytes, user_id: str) -> Dict:
        """Process voice command end-to-end"""
        try:
            # 1. Detect language
            detection = await self.detect_language(audio_data)
            
            # 2. Transcribe speech
            transcription = await self.transcribe_speech(
                audio_data,
                detection['language_code']
            )
            
            # 3. Analyze intent (simplified)
            intent = self._analyze_intent(transcription['text'])
            
            # 4. Generate response
            response_text = self._generate_response(intent, transcription)
            
            # 5. Convert to speech
            response_audio = await self.generate_speech(
                response_text,
                detection['language_code']
            )
            
            # 6. Log interaction
            await self._log_interaction(user_id, {
                'detection': detection,
                'transcription': transcription,
                'intent': intent,
                'response': response_text,
                'timestamp': datetime.now().isoformat()
            })
            
            return {
                'success': True,
                'detected_language': detection,
                'transcription': transcription,
                'intent': intent,
                'response_text': response_text,
                'response_audio': response_audio.hex() if response_audio else None,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Voice command processing failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    def _analyze_intent(self, text: str) -> Dict:
        """Analyze user intent from text"""
        intents = {
            'track_order': ['track', 'order', 'package', 'shipment', 'delivery'],
            'check_eta': ['eta', 'time', 'reach', 'arrive', 'when'],
            'cancel_order': ['cancel', 'stop', 'abort'],
            'payment_status': ['payment', 'paid', 'money', 'released', 'escrow'],
            'contact_support': ['help', 'support', 'assist', 'problem', 'issue'],
            'find_truck': ['find', 'truck', 'load', 'availability'],
            'driver_location': ['driver', 'location', 'where', 'current']
        }
        
        text_lower = text.lower()
        detected_intents = []
        
        for intent, keywords in intents.items():
            for keyword in keywords:
                if keyword in text_lower:
                    detected_intents.append(intent)
                    break
        
        if detected_intents:
            return {
                'primary': detected_intents[0],
                'all': detected_intents,
                'confidence': 0.8
            }
        
        return {
            'primary': 'unknown',
            'all': [],
            'confidence': 0.2
        }
    
    def _generate_response(self, intent: Dict, transcription: Dict) -> str:
        """Generate response based on intent"""
        responses = {
            'track_order': 'आपका ऑर्डर ट्रैक किया जा रहा है। कृपया कुछ समय प्रतीक्षा करें।',
            'check_eta': 'आपका ऑर्डर 30 मिनट में पहुंच जाएगा।',
            'cancel_order': 'आपका ऑर्डर कैंसिल कर दिया गया है।',
            'payment_status': 'आपका पेमेंट रिलीज़ हो गया है।',
            'contact_support': 'हम आपकी सहायता के लिए उपलब्ध हैं।',
            'find_truck': 'हम आपके लिए निकटतम ट्रक ढूंढ रहे हैं।',
            'driver_location': 'आपका ड्राइवर आपके निकट है।'
        }
        
        response = responses.get(
            intent['primary'],
            'कृपया अपनी बात दोहराएं। मुझे समझ नहीं आया।'
        )
        
        # Add language context
        lang_name = transcription.get('language_name', 'Hindi')
        return f"({lang_name}) {response}"
    
    async def _log_interaction(self, user_id: str, data: Dict):
        """Log voice interaction for analytics"""
        try:
            # Store in Redis
            key = f"voice:interaction:{user_id}:{datetime.now().timestamp()}"
            self.redis.setex(
                key,
                86400 * 7,  # 7 days
                json.dumps(data)
            )
            
            # Store in database (simplified)
            # In production, store in PostgreSQL/MongoDB
            
        except Exception as e:
            logger.error(f"Interaction logging failed: {e}")
    
    def get_supported_languages(self) -> Dict:
        """Get list of supported languages"""
        return {
            'languages': self.languages,
            'count': len(self.languages),
            'dialects': self.supported_dialects,
            'total_dialects': len(self.supported_dialects)
        }
    
    async def get_language_stats(self) -> Dict:
        """Get language usage statistics"""
        stats = {}
        for lang_code in self.languages.keys():
            key = f"voice:stats:{lang_code}"
            count = self.redis.get(key)
            stats[lang_code] = int(count) if count else 0
        
        return stats
    
    def increment_language_usage(self, language_code: str):
        """Increment language usage counter"""
        key = f"voice:stats:{language_code}"
        self.redis.incr(key)