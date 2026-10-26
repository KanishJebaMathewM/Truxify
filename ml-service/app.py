import logging
from fastapi import FastAPI, Request

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger("ml_service")

app = FastAPI(title="Truxify ML Engine", version="1.0.0")

@app.middleware("http")
async def correlation_id_middleware(request: Request, call_next):
    correlation_id = request.headers.get("x-correlation-id") or request.headers.get("X-Correlation-ID")
    if correlation_id:
        logger.info(f"Incoming request {request.method} {request.url.path} [correlationId={correlation_id}]")
    else:
        logger.info(f"Incoming request {request.method} {request.url.path}")
    response = await call_next(request)
    if correlation_id:
        response.headers["X-Correlation-ID"] = correlation_id
    return response

# Mock or actual loaded models dictionary/list
loaded_models = {"pricing": True, "eta": True, "demand": True, "matching": True}

@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": len(loaded_models)
    }

