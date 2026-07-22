from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routes import router
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Truxify SMPC Service",
    description="Secure Multi-Party Computation for Privacy-Preserving Analytics",
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
        "service": "smpc",
        "version": "1.0.0"
    }

@app.get("/")
async def root():
    return {
        "message": "Truxify SMPC Service is running",
        "endpoints": [
            "/smpc/register",
            "/smpc/session/initiate",
            "/smpc/share",
            "/smpc/aggregate",
            "/smpc/stats"
        ]
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8004)