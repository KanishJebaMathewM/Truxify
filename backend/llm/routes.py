from fastapi import APIRouter, HTTPException, UploadFile, File
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import logging
from datetime import datetime
from llm_service import LLMService

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/llm", tags=["LLM Support"])

# Initialize LLM service
llm_service = LLMService()

class QueryRequest(BaseModel):
    query: str
    language: Optional[str] = 'en'
    user_id: Optional[str] = None

class DocumentRequest(BaseModel):
    documents: List[str]
    metadata: Optional[List[Dict]] = None

@router.post("/query")
async def process_query(request: QueryRequest):
    """Process driver query with LLM"""
    try:
        result = await llm_service.process_query(
            request.query,
            request.language,
            request.user_id
        )
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Query processing failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rag/documents")
async def add_documents(request: DocumentRequest):
    """Add documents to RAG vector DB"""
    try:
        result = await llm_service.add_to_vector_db(
            request.documents,
            request.metadata
        )
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Document addition failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history/{user_id}")
async def get_conversation_history(user_id: str, limit: int = 10):
    """Get conversation history"""
    try:
        history = await llm_service.get_conversation_history(user_id, limit)
        return {
            'success': True,
            'data': history,
            'count': len(history),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"History retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/fine-tune")
async def fine_tune_model(file: UploadFile = File(...)):
    """Fine-tune LLM with custom data"""
    try:
        # Save uploaded file
        content = await file.read()
        with open('training_data.json', 'wb') as f:
            f.write(content)
        
        result = await llm_service.fine_tune_model('training_data.json')
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Fine-tuning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_model_stats():
    """Get LLM model statistics"""
    try:
        stats = await llm_service.get_model_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats retrieval failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/languages")
async def get_supported_languages():
    """Get supported languages"""
    return {
        'success': True,
        'data': {
            'languages': llm_service.supported_languages,
            'count': len(llm_service.supported_languages)
        },
        'timestamp': datetime.now().isoformat()
    }