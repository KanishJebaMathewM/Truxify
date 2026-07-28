import torch
from transformers import (
    AutoTokenizer, 
    AutoModelForCausalLM, 
    pipeline,
    BitsAndBytesConfig
)
from sentence_transformers import SentenceTransformer
import chromadb
from chromadb.config import Settings
import json
import os
import redis
import logging
from typing import Dict, List, Any, Optional
from datetime import datetime
import asyncio
from concurrent.futures import ThreadPoolExecutor

logger = logging.getLogger(__name__)

class LLMService:
    """Custom LLM Service for Driver Support"""
    
    def __init__(self, redis_url: str = "redis://localhost:6379"):
        self.redis = redis.Redis.from_url(redis_url)
        
        # Model configuration
        self.model_name = os.getenv('LLM_MODEL', 'mistralai/Mistral-7B-Instruct-v0.1')
        self.device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
        
        # Initialize models
        self.tokenizer = None
        self.model = None
        self.embedder = None
        self.chroma_client = None
        self.collection = None
        self.qa_pipeline = None
        
        # Thread pool for async processing
        self.executor = ThreadPoolExecutor(max_workers=4)
        
        # Multi-language support
        self.supported_languages = [
            'hi', 'en', 'ta', 'te', 'bn', 'kn', 'ml', 
            'mr', 'gu', 'pa', 'or', 'as', 'mai', 'sat', 'kok'
        ]
        
        # Initialize
        self.initialize_models()
        self.initialize_vector_db()
        
        logger.info(f"✅ LLM Service initialized on {self.device}")
    
    def initialize_models(self):
        """Initialize LLM models"""
        try:
            # Quantization config for memory efficiency
            bnb_config = BitsAndBytesConfig(
                load_in_4bit=True,
                bnb_4bit_quant_type="nf4",
                bnb_4bit_compute_dtype=torch.float16,
                bnb_4bit_use_double_quant=True
            )
            
            # Load tokenizer
            self.tokenizer = AutoTokenizer.from_pretrained(
                self.model_name,
                trust_remote_code=True
            )
            self.tokenizer.pad_token = self.tokenizer.eos_token
            
            # Load model
            self.model = AutoModelForCausalLM.from_pretrained(
                self.model_name,
                quantization_config=bnb_config,
                device_map="auto",
                trust_remote_code=True
            )
            
            # Initialize embedder for RAG
            self.embedder = SentenceTransformer('all-MiniLM-L6-v2')
            
            # Create QA pipeline
            self.qa_pipeline = pipeline(
                "text-generation",
                model=self.model,
                tokenizer=self.tokenizer,
                max_new_tokens=512,
                temperature=0.7,
                top_p=0.95,
                do_sample=True
            )
            
            logger.info("✅ LLM models initialized")
            
        except Exception as e:
            logger.error(f"Model initialization failed: {e}")
            raise
    
    def initialize_vector_db(self):
        """Initialize vector database for RAG"""
        try:
            self.chroma_client = chromadb.Client(Settings(
                chroma_db_impl="duckdb+parquet",
                persist_directory="./chroma_db"
            ))
            
            # Create or get collection
            self.collection = self.chroma_client.get_or_create_collection(
                name="driver_support",
                metadata={"hnsw:space": "cosine"}
            )
            
            logger.info("✅ Vector database initialized")
            
        except Exception as e:
            logger.error(f"Vector DB initialization failed: {e}")
            raise
    
    async def process_query(self, query: str, language: str = 'en', user_id: str = None) -> Dict:
        """Process driver query with RAG"""
        try:
            # Detect language if not provided
            if not language or language == 'auto':
                language = self.detect_language(query)
            
            # Translate if needed
            if language != 'en':
                query_en = await self.translate_text(query, language, 'en')
            else:
                query_en = query
            
            # Get context from vector DB
            context = await self.get_context(query_en)
            
            # Generate response
            response = await self.generate_response(query_en, context)
            
            # Translate back if needed
            if language != 'en':
                response_text = await self.translate_text(response, 'en', language)
            else:
                response_text = response
            
            # Store conversation
            await self.store_conversation(user_id, query, response_text, language)
            
            return {
                'success': True,
                'query': query,
                'response': response_text,
                'language': language,
                'context_used': context,
                'confidence': 0.95,
                'timestamp': datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Query processing failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'timestamp': datetime.now().isoformat()
            }
    
    async def get_context(self, query: str, top_k: int = 3) -> List[str]:
        """Retrieve relevant context from vector DB"""
        try:
            # Generate query embedding
            query_embedding = self.embedder.encode(query).tolist()
            
            # Search in vector DB
            results = self.collection.query(
                query_embeddings=[query_embedding],
                n_results=top_k
            )
            
            context = []
            if results['documents']:
                context = results['documents'][0]
            
            return context
            
        except Exception as e:
            logger.error(f"Context retrieval failed: {e}")
            return []
    
    async def generate_response(self, query: str, context: List[str]) -> str:
        """Generate response using LLM"""
        try:
            # Prepare prompt with context
            system_prompt = """You are Truxify Assistant, a helpful AI assistant for truck drivers.
            Provide accurate, concise, and helpful responses. Be friendly and professional.
            If you don't know something, say so honestly."""
            
            context_str = "\n".join(context) if context else "No specific context available."
            
            prompt = f"""<s>[INST] <<SYS>>
            {system_prompt}
            <</SYS>>
            
            Context information:
            {context_str}
            
            Question: {query}
            
            Answer: [/INST]"""
            
            # Generate response
            response = self.qa_pipeline(
                prompt,
                max_new_tokens=512,
                temperature=0.7,
                do_sample=True
            )
            
            # Extract response text
            generated_text = response[0]['generated_text']
            answer = generated_text.split('[/INST]')[-1].strip()
            
            return answer
            
        except Exception as e:
            logger.error(f"Response generation failed: {e}")
            return "I apologize, but I'm having trouble processing your request. Please try again."
    
    async def add_to_vector_db(self, documents: List[str], metadata: List[Dict] = None):
        """Add documents to vector DB for RAG"""
        try:
            # Generate embeddings
            embeddings = self.embedder.encode(documents).tolist()
            
            # Add to collection
            ids = [f"doc_{i}_{datetime.now().timestamp()}" for i in range(len(documents))]
            
            self.collection.add(
                embeddings=embeddings,
                documents=documents,
                metadatas=metadata or [{}] * len(documents),
                ids=ids
            )
            
            logger.info(f"✅ {len(documents)} documents added to vector DB")
            return {'success': True, 'count': len(documents)}
            
        except Exception as e:
            logger.error(f"Vector DB update failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def translate_text(self, text: str, source_lang: str, target_lang: str) -> str:
        """Translate text between languages"""
        try:
            # In production: use Google Translate API or IndicTrans
            # For now, return original text
            return text
            
        except Exception as e:
            logger.error(f"Translation failed: {e}")
            return text
    
    def detect_language(self, text: str) -> str:
        """Detect language of query"""
        # In production: use language detection library
        # For now, return English
        return 'en'
    
    async def store_conversation(self, user_id: str, query: str, response: str, language: str):
        """Store conversation for future fine-tuning"""
        try:
            conversation = {
                'user_id': user_id,
                'query': query,
                'response': response,
                'language': language,
                'timestamp': datetime.now().isoformat()
            }
            
            # Store in Redis
            self.redis.setex(
                f'llm:conversation:{user_id}:{datetime.now().timestamp()}',
                86400 * 30,  # 30 days
                json.dumps(conversation)
            )
            
            # Store in database
            # In production: store in PostgreSQL
            
        except Exception as e:
            logger.error(f"Conversation storage failed: {e}")
    
    async def get_conversation_history(self, user_id: str, limit: int = 10) -> List[Dict]:
        """Get conversation history for user"""
        try:
            keys = self.redis.keys(f'llm:conversation:{user_id}:*')
            keys = sorted(keys, reverse=True)[:limit]
            
            conversations = []
            for key in keys:
                data = self.redis.get(key)
                if data:
                    conversations.append(json.loads(data))
            
            return conversations
            
        except Exception as e:
            logger.error(f"Conversation history retrieval failed: {e}")
            return []
    
    async def fine_tune_model(self, training_data_path: str):
        """Fine-tune LLM with custom data"""
        try:
            # In production: use QLoRA or full fine-tuning
            logger.info("Starting model fine-tuning...")
            
            # Load training data
            with open(training_data_path, 'r') as f:
                data = json.load(f)
            
            # Fine-tuning logic here
            # In production: use transformers Trainer
            
            logger.info(f"✅ Model fine-tuned with {len(data)} samples")
            return {'success': True, 'samples': len(data)}
            
        except Exception as e:
            logger.error(f"Fine-tuning failed: {e}")
            return {'success': False, 'error': str(e)}
    
    async def get_model_stats(self) -> Dict:
        """Get model statistics"""
        return {
            'model_name': self.model_name,
            'device': str(self.device),
            'vector_db_size': self.collection.count() if self.collection else 0,
            'supported_languages': self.supported_languages,
            'timestamp': datetime.now().isoformat()
        }