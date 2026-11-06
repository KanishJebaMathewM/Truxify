import os
import sys

# Ensure repository root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from fastapi import FastAPI
from routers.hos_compliance import router as hos_router

try:
    from routers.load_optimiser import router as load_optimiser_router
except ImportError:
    load_optimiser_router = None

try:
    from routers.deadhead import router as deadhead_router
except ImportError:
    deadhead_router = None

app = FastAPI(title="Truxify ML Engine", version="1.0.0")

if load_optimiser_router:
    app.include_router(load_optimiser_router)
if deadhead_router:
    app.include_router(deadhead_router)
app.include_router(hos_router)

# Mock or actual loaded models dictionary/list
loaded_models = {
    "pricing": True,
    "eta": True,
    "demand": True,
    "matching": True,
    "load_optimiser": True,
}


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": len(loaded_models)
    }
