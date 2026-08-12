from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import router
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Truxify LLM Service",
    description="Custom LLM for Driver Support with RAG",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)

@app.get("/health")
async def health():
    return {
        "status": "healthy",
        "service": "llm",
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    return {
        "message": "Truxify LLM Service is running",
        "endpoints": [
            "/llm/query",
            "/llm/rag/documents",
            "/llm/history/{user_id}",
            "/llm/fine-tune",
            "/llm/stats",
            "/llm/languages"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8005)