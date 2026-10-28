from fastapi import FastAPI
from routers.hos_compliance import router as hos_router

app = FastAPI(title="Truxify ML Engine", version="1.0.0")

# Mock or actual loaded models dictionary/list
loaded_models = {"pricing": True, "eta": True, "demand": True, "matching": True}

app.include_router(hos_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": len(loaded_models)
    }
