from fastapi import FastAPI
from routers.fuel_surcharge import router as fuel_surcharge_router

app = FastAPI(title="Truxify ML Engine", version="1.0.0")

# Mock or actual loaded models dictionary/list
loaded_models = {"pricing": True, "eta": True, "demand": True, "matching": True}

app.include_router(fuel_surcharge_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "models_loaded": len(loaded_models)
    }
