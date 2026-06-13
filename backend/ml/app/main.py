import logging
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
from typing import List, Optional

from .models.demand_forecast import (
    predict_demand,
    train_demand_forecast_model,
    FEATURE_NAMES,
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