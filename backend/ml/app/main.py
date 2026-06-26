import asyncio
import hmac
import logging
import os
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional

from .models.demand_forecast import (
    predict_demand,
    train_demand_forecast_model,
    FEATURE_NAMES,
)
from .models.price_prediction import predict_price

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

async def verify_api_key(x_api_key: str = Header(None, alias="X-API-Key")):
    ml_api_key = os.environ.get("ML_API_KEY")
    if not ml_api_key:
        return
    if not x_api_key or not hmac.compare_digest(x_api_key, ml_api_key):
        raise HTTPException(status_code=401, detail="Unauthorized")

app = FastAPI(
    title="Truxify ML Engine",
    description="Machine Learning microservice for Truxify",
    version="1.0.0",
)

# CORS: restrict to known origins — no wildcard "*" to prevent unauthorized cross-origin access
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5000",   # Node.js API development
        "http://127.0.0.1:5000",
        "http://localhost:8000",   # FastAPI itself (browser testing)
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["X-API-Key", "Content-Type"],
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


class PricePredictInput(BaseModel):
    distance_km: float = Field(..., gt=0, description="Route distance in kilometres")
    cargo_weight_kg: float = Field(..., gt=0, description="Cargo weight in kilograms")
    truck_type: str = Field("medium_truck", description="Type of truck (light_truck, medium_truck, heavy_truck, trailer)")
    route_origin: str = Field("", description="Origin location name")
    route_destination: str = Field("", description="Destination location name")


class PricePredictOutput(BaseModel):
    estimated_price: float
    currency: str = "INR"


class TrainResponse(BaseModel):
    status: str
    metrics: dict


@app.get("/")
async def root(_auth=Depends(verify_api_key)):
    return {"message": "Truxify ML Engine is running"}


@app.get("/health")
async def health():
    return {"status": "healthy"}


@app.post("/predict/demand", response_model=DemandForecastOutput)
async def predict_demand_endpoint(input: DemandForecastInput, _auth=Depends(verify_api_key)):
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


@app.post("/predict", response_model=PricePredictOutput)
async def predict_price_endpoint(input: PricePredictInput, _auth=Depends(verify_api_key)):
    try:
        price = predict_price(
            distance_km=input.distance_km,
            cargo_weight_kg=input.cargo_weight_kg,
            truck_type=input.truck_type,
            route_origin=input.route_origin,
            route_destination=input.route_destination,
        )
        return PricePredictOutput(estimated_price=price)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Price prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Price prediction failed")


@app.post("/train/demand", response_model=TrainResponse)
async def train_demand_endpoint(_auth=Depends(verify_api_key)):
    timeout = int(os.environ.get("ML_TRAINING_TIMEOUT_SECONDS", 300))
    try:
        metrics = await asyncio.wait_for(
            asyncio.to_thread(train_demand_forecast_model),
            timeout=timeout,
        )
        return TrainResponse(status="success", metrics=metrics)
    except asyncio.TimeoutError:
        logger.error("Demand model training timed out after %d seconds", timeout)
        raise HTTPException(status_code=504, detail="Training timed out")
    except Exception as e:
        logger.error("Demand model training failed: %s", e)
        raise HTTPException(status_code=500, detail="Training failed")


@app.get("/models")
async def list_models(_auth=Depends(verify_api_key)):
    from .models.base import MODEL_STORAGE_DIR
    import os, json
    models = []
    if os.path.isdir(MODEL_STORAGE_DIR):
        for f in os.listdir(MODEL_STORAGE_DIR):
            if f.endswith("_meta.json"):
                with open(os.path.join(MODEL_STORAGE_DIR, f)) as fh:
                    models.append(json.load(fh))
    return {"models": models}