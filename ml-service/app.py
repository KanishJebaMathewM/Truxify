from fastapi import FastAPI
from routers.load_optimiser import router as load_optimiser_router
from routers.deadhead import router as deadhead_router

app = FastAPI(title="Truxify ML Engine", version="1.0.0")

app.include_router(load_optimiser_router)
app.include_router(deadhead_router)

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
