import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

from .models.demand_forecast import (
    predict_demand,
    train_demand_forecast_model,
    rollback_demand_forecast_model,
    FEATURE_NAMES,
)
from .models.base import (
    get_active_generation,
    get_previous_generation,
    get_generation_meta,
    get_model_meta,
    rollback_model,
    backup_model,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Truxify ML Engine",
    description="Machine Learning microservice for Truxify",
    version="1.0.0",
)


class DemandForecastInput(BaseModel):
    hour: float = Field(..., ge=0, le=23, description="Hour of the day (0-23)")
    day_of_week: float = Field(..., ge=0, le=6, description="Day of week (0=Sunday, 6=Saturday)")
    temperature: float = Field(..., description="Temperature in Celsius")
    precipitation: float = Field(..., ge=0, description="Precipitation in mm")
    historical_volume: float = Field(..., ge=0, description="Historical booking volume")
    nearby_drivers: float = Field(..., ge=0, description="Number of nearby available drivers")


class DemandForecastOutput(BaseModel):
    predicted_demand: float
    model_version: str = "1.0.0"
    feature_names: List[str] = FEATURE_NAMES


class TrainResponse(BaseModel):
    status: str
    metrics: dict


@app.get("/")
async def root():
    return {"message": "Truxify ML Engine is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/predict/demand", response_model=DemandForecastOutput)
async def predict_demand_endpoint(input: DemandForecastInput):
    features = [
        input.hour,
        input.day_of_week,
        1 if input.day_of_week >= 5 else 0,
        input.temperature,
        input.precipitation,
        input.historical_volume,
        input.nearby_drivers,
    ]
    try:
        demand = predict_demand(features)
        if demand is None:
            raise HTTPException(status_code=503, detail="Model not available")
        return DemandForecastOutput(predicted_demand=demand)
    except Exception as e:
        logger.error("Demand prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Prediction failed")


@app.post("/train/demand", response_model=TrainResponse)
async def train_demand_endpoint():
    try:
        metrics = train_demand_forecast_model()
        return TrainResponse(status="success", metrics=metrics)
    except Exception as e:
        logger.error("Demand model training failed: %s", e)
        raise HTTPException(status_code=500, detail="Training failed")


@app.post("/train/demand/rollback")
async def rollback_demand_endpoint():
    """Roll back the demand-forecast model to its previously-promoted version."""
    try:
        result = rollback_demand_forecast_model()
        return result
    except Exception as e:
        logger.error("Demand model rollback failed: %s", e)
        raise HTTPException(status_code=500, detail="Rollback failed")


@app.get("/models/demand/status")
async def demand_model_status():
    """Compare active demand model with its rollback baseline."""
    model_name = "demand_forecast"
    active_version = get_active_generation(model_name)
    previous_version = get_previous_generation(model_name)
    active_meta = get_generation_meta(model_name, active_version) if active_version else None
    previous_meta = get_generation_meta(model_name, previous_version) if previous_version else None
    active_mae = (active_meta or {}).get("metrics", {}).get("mae")
    previous_mae = (previous_meta or {}).get("metrics", {}).get("mae")
    active_r2 = (active_meta or {}).get("metrics", {}).get("r2")
    previous_r2 = (previous_meta or {}).get("metrics", {}).get("r2")

    return {
        "model_name": model_name,
        "active_version": active_version,
        "previous_version": previous_version,
        "active_metrics": (active_meta or {}).get("metrics", {}),
        "previous_metrics": (previous_meta or {}).get("metrics", {}),
        "rollback_available": previous_version is not None,
        "should_rollback": (
            active_mae is not None
            and previous_mae is not None
            and active_mae > previous_mae
        ),
    }


@app.get("/models/{model_name}/status")
async def model_status(model_name: str):
    """Get active and previous generation status and metrics for *model_name*."""
    active_version = get_active_generation(model_name)
    previous_version = get_previous_generation(model_name)
    active_meta = get_generation_meta(model_name, active_version) if active_version else None
    previous_meta = get_generation_meta(model_name, previous_version) if previous_version else None

    return {
        "model_name": model_name,
        "active_version": active_version,
        "previous_version": previous_version,
        "active_metrics": (active_meta or {}).get("metrics", {}),
        "previous_metrics": (previous_meta or {}).get("metrics", {}),
        "rollback_available": previous_version is not None,
    }


@app.post("/models/{model_name}/rollback")
async def model_rollback_endpoint(model_name: str):
    """Roll back *model_name* to its previous generation."""
    try:
        result = rollback_model(model_name)
        return result
    except Exception as e:
        logger.error("Model '%s' rollback failed: %s", model_name, e)
        raise HTTPException(status_code=500, detail="Rollback failed")


@app.post("/models/{model_name}/backup")
async def model_backup_endpoint(model_name: str):
    """Create an explicit backup of the current active model generation."""
    try:
        backup_gen = backup_model(model_name)
        if not backup_gen:
            raise HTTPException(status_code=400, detail="No active model generation to backup")
        return {"status": "success", "model_name": model_name, "backup_generation": backup_gen}
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Model '%s' backup failed: %s", model_name, e)
        raise HTTPException(status_code=500, detail="Backup failed")


@app.get("/models")
async def list_models():
    from .models.base import MODEL_STORAGE_DIR
    import os, json
    models = []
    if os.path.isdir(MODEL_STORAGE_DIR):
        for f in os.listdir(MODEL_STORAGE_DIR):
            if f.endswith("_meta.json"):
                with open(os.path.join(MODEL_STORAGE_DIR, f)) as fh:
                    models.append(json.load(fh))
    return {"models": models}