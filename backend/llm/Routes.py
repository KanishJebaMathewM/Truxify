import os
import logging
from uuid import uuid4
from fastapi import APIRouter, UploadFile, File, HTTPException
from backend.llm.security import validate_upload_file
from backend.llm.service import llm_service

logger = logging.getLogger("truxify.llm.routes")
router = APIRouter()

@router.post("/fine-tune")
async def fine_tune_model(file: UploadFile = File(...)):
    # Fix 1: Validate upload file size and content type via security utility
    await validate_upload_file(file)
    
    # Fix 2: Generate per-request unique filename to prevent race conditions / data clobbering
    unique_filename = f"training_{uuid4()}.json"
    
    try:
        content = await file.read()
        with open(unique_filename, 'wb') as f:
            f.write(content)
            
        logger.info(f"Starting model fine-tuning with secure temporary dataset: {unique_filename}")
        result = await llm_service.fine_tune_model(unique_filename)
        return {"success": True, "result": result}
        
    except Exception as err:
        logger.error(f"Error during LLM fine-tuning process: {err}")
        raise HTTPException(status_code=500, detail=str(err))
        
    finally:
        # Fix 3: Ensure temporary training file is cleaned up in a finally block
        if os.path.exists(unique_filename):
            try:
                os.remove(unique_filename)
                logger.info(f"Cleaned up temporary training dataset: {unique_filename}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to remove temporary file {unique_filename}: {cleanup_err}")
