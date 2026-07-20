from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import voice_routes
import os
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Truxify Voice AI Service",
    description="Multi-language voice AI with regional dialect support for Indian languages",
    version="1.0.0"
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routes
app.include_router(voice_routes.router)

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "voice-ai",
        "languages": len(voice_routes.voice_service.languages),
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    return {
        "message": "Truxify Voice AI Service is running",
        "languages": len(voice_routes.voice_service.languages),
        "endpoints": [
            "/voice/process",
            "/voice/detect-language",
            "/voice/transcribe",
            "/voice/synthesize",
            "/voice/languages",
            "/voice/stats",
            "/voice/dialects/{language_code}"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)