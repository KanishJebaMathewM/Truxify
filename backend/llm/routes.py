from fastapi import APIRouter, HTTPException, UploadFile, File, Depends
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import json
import logging
from datetime import datetime
from llm_service import LLMService
from security import (
    require_user,
    require_rag_write,
    require_rag_read,
    validate_upload_file,
    sanitize_filename,
)

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/llm", tags=["LLM Support"])

# Initialize LLM service
llm_service = LLMService()

# Constants
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
_ALLOWED_UPLOAD_TYPES = {
    "application/json",
    "text/plain",
    "application/pdf",
}


class QueryRequest(BaseModel):
    query: str
    language: Optional[str] = 'en'


class DocumentRequest(BaseModel):
    documents: List[str]
    metadata: Optional[List[Dict]] = None


@router.post("/query")
async def process_query(
    request: QueryRequest,
    user_id: str = Depends(require_user)
):
    """Process driver query with LLM (authenticated)"""
    try:
        result = await llm_service.process_query(
            request.query,
            request.language,
            user_id
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
async def add_documents(
    request: DocumentRequest,
    user_id: str = Depends(require_rag_write)
):
    """Add documents to RAG vector DB (requires rag:write scope)"""
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


@router.get("/history")
async def get_conversation_history(
    limit: int = 10,
    user_id: str = Depends(require_user)
):
    """Get conversation history for authenticated user"""
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
async def fine_tune_model(
    file: UploadFile = File(...),
    user_id: str = Depends(require_rag_write)
):
    """Fine-tune LLM with custom data (requires rag:write scope)"""
    try:
        # Validate and read file securely
        content = await validate_upload_file(
            file,
            max_size=MAX_UPLOAD_BYTES,
            allowed_types=_ALLOWED_UPLOAD_TYPES
        )
        
        # Save with sanitized filename (server-controlled path)
        safe_name = sanitize_filename(file.filename or "training_data.json")
        if not safe_name.endswith(".json"):
            safe_name = "training_data.json"
        
        # Write to a controlled path (no user-controlled path components)
        import tempfile
        with tempfile.NamedTemporaryFile(mode='wb', suffix='.json', delete=False) as f:
            f.write(content)
            training_path = f.name
        
        try:
            result = await llm_service.fine_tune_model(training_path)
        finally:
            # Clean up temp file
            import os
            try:
                os.unlink(training_path)
            except OSError:
                pass
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Fine-tuning failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/stats")
async def get_model_stats(
    user_id: str = Depends(require_rag_read)
):
    """Get LLM model statistics (requires rag:read scope)"""
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
async def get_supported_languages(
    user_id: str = Depends(require_user)
):
    """Get supported languages (authenticated)"""
    return {
        'success': True,
        'data': {
            'languages': llm_service.supported_languages,
            'count': len(llm_service.supported_languages)
        },
        'timestamp': datetime.now().isoformat()
    }