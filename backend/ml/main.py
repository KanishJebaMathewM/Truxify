import asyncio
import logging
import os
import time

# Initialize Sentry as early as possible
import sentry_sdk
from sentry_sdk.integrations.fastapi import FastApiIntegration

sentry_dsn = os.environ.get("SENTRY_DSN")
if sentry_dsn:
    sentry_sdk.init(
        dsn=sentry_dsn,
        environment=os.environ.get("ENVIRONMENT", "development"),
        integrations=[
            FastApiIntegration(
                transaction_style="endpoint"
            ),
        ],
        traces_sample_rate=1.0,
    )

import numpy as np
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Depends, Query, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from app.models.eta_prediction import eta_predictor

from app.models.demand_forecast import (
    predict_demand,
    train_demand_forecast_model,
    rollback_demand_forecast_model,
    FEATURE_NAMES,
)
from app.models.price_prediction import (
    predict_price,
    train_price_model,
    close_weather_resources,
    PriceModelDataUnavailableError,
)
from app.execution import (
    run_inference,
    close_inference_executor,
    close_training_executor,
    run_training_job,
    inference_capacity,
)
from app.models.bilateral_matcher import match_bilateral
from app.models.driver_profit import driver_profit_predictor
from app.models.bin_packing import optimise_packing
from app.models.collaborative_filter import collaborative_filter
from app.models.trust_scorer import trust_scorer
from app.models.deadhead_eliminator import find_return_loads
from app.models.mid_trip_reoptimiser import find_mid_trip_loads
from app.models.ocr_verifier import ocr_verifier
from app.models.base import (
    model_exists,
    get_model_meta,
    get_active_generation,
    get_previous_generation,
    get_generation_meta,
    get_model_lock,
)
from app.models.demand_forecast import MODEL_NAME as DEMAND_MODEL_NAME
from app.models.price_prediction import MODEL_NAME as PRICE_MODEL_NAME
from routes import register_ml_routers, verify_api_key

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Track loaded models for health reporting
loaded_models: set[str] = set()


import os

app = FastAPI(
    title="Truxify ML Engine",
    description="ML prediction service for load matching, pricing, ETA, and route optimization",
    version="1.0.0",
    # Swagger/ReDoc interactive docs are disabled in production.
    docs_url=None if os.environ.get("ENVIRONMENT") == "production" else "/docs",
    redoc_url=None if os.environ.get("ENVIRONMENT") == "production" else "/redoc",
)



# Register all available ML route modules dynamically
registered_routers = register_ml_routers(app)
logger.info("ML routers registered: %s", registered_routers)

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


@app.on_event("startup")
async def startup_event():
    from app.models.base import preload_all_models

    logger.info("ML Engine starting, pre-loading models...")
    persisted_models = await preload_all_models()
    loaded_models.update(persisted_models)
    if eta_predictor.model is not None:
        loaded_models.add("eta_prediction")
    logger.info(
        "ML Engine startup complete — loaded: %s, inference capacity: %d",
        sorted(loaded_models),
        inference_capacity(),
    )


@app.on_event("shutdown")
async def shutdown_event():
    logger.info("ML Engine shutting down — releasing executors and HTTP clients")
    close_inference_executor()
    close_training_executor()
    close_weather_resources()


# ---------------------------------------------------------------------------
# Schemas — Demand Forecast
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Schemas — Price Prediction
# ---------------------------------------------------------------------------

class PricePredictInput(BaseModel):
    distance_km: float = Field(..., gt=0, description="Route distance in kilometres")
    cargo_weight_kg: float = Field(..., gt=0, description="Cargo weight in kilograms")
    truck_type: str = Field("medium_truck", description="Type of truck (light_truck, medium_truck, heavy_truck, trailer)")
    route_origin: str = Field("", description="Origin location name")
    route_destination: str = Field("", description="Destination location name")
    hour_of_day: int = Field(12, ge=0, le=23, description="Hour of day (0-23)")
    day_of_week: int = Field(3, ge=0, le=6, description="Day of week (0-6)")
    month: int = Field(6, ge=1, le=12, description="Month (1-12)")
    fuel_price: float = Field(105.0, gt=0, description="Fuel price in INR/L")
    cargo_type: str = Field("general", description="Cargo type (general, perishable, fragile, hazardous, bulk)")


class PricePredictOutput(BaseModel):
    estimated_price: float
    min_price: float
    max_price: float
    currency: str = "INR"


# ---------------------------------------------------------------------------
# Schemas — Bilateral Matcher
# ---------------------------------------------------------------------------

class LoadItem(BaseModel):
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lng: float = Field(..., ge=-180, le=180)
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lng: float = Field(..., ge=-180, le=180)
    weight_kg: float = Field(..., gt=0)
    length_m: float = Field(..., gt=0)
    width_m: float = Field(..., gt=0)
    height_m: float = Field(..., gt=0)
    deadline_hours: float = Field(..., gt=0)


class DriverItem(BaseModel):
    current_lat: float = Field(..., ge=-90, le=90)
    current_lng: float = Field(..., ge=-180, le=180)
    max_weight_kg: float = Field(..., gt=0)
    max_length_m: float = Field(..., gt=0)
    max_width_m: float = Field(..., gt=0)
    max_height_m: float = Field(..., gt=0)
    preferred_dest_lat: Optional[float] = Field(0.0, ge=-90, le=90)
    preferred_dest_lng: Optional[float] = Field(0.0, ge=-180, le=180)
    rating: float = Field(3.0, ge=1, le=5)


class BilateralMatchInput(BaseModel):
    loads: List[LoadItem]
    drivers: List[DriverItem]


class MatchAssignment(BaseModel):
    load_index: int
    driver_index: int
    match_score: float


class BilateralMatchOutput(BaseModel):
    assignments: List[MatchAssignment]
    unmatched_loads: List[int]
    unmatched_drivers: List[int]


# ---------------------------------------------------------------------------
# Schemas — Driver Profit Predictor
# ---------------------------------------------------------------------------

class DriverProfitInput(BaseModel):
    route_distance: float = Field(..., gt=0, description="Route distance in km")
    fuel_price: float = Field(..., gt=0, description="Fuel price in INR/L")
    toll_estimate: float = Field(..., ge=0, description="Toll estimate in INR")
    truck_mileage: float = Field(..., gt=0, description="Truck mileage in km/L")
    cargo_weight: float = Field(..., gt=0, description="Cargo weight in kg")
    trip_duration: float = Field(..., gt=0, description="Trip duration in hours")


class DriverProfitOutput(BaseModel):
    predicted_profit: float
    confidence_interval: dict


# ---------------------------------------------------------------------------
# Schemas — 3D Bin Packer + VRP
# ---------------------------------------------------------------------------

class PackageItem(BaseModel):
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)
    weight: float = Field(..., gt=0)


class TruckDimensions(BaseModel):
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    height: float = Field(..., gt=0)
    max_weight: float = Field(..., gt=0)


class DeliveryAddress(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class PackingInput(BaseModel):
    packages: List[PackageItem]
    truck: TruckDimensions
    delivery_addresses: List[DeliveryAddress]


class PackingOutput(BaseModel):
    packing_arrangement: list
    unpacked_packages: List[int]
    stop_sequence: List[int]
    utilization_pct: float


# ---------------------------------------------------------------------------
# Schemas — Collaborative Filter
# ---------------------------------------------------------------------------

class RecommendLoadsInput(BaseModel):
    user_id: str = Field(..., description="User ID")
    booking_history: List[dict] = Field(default_factory=list)
    rated_drivers: List[dict] = Field(default_factory=list)
    top_n: int = Field(5, ge=1, le=50)


class RecommendTrucksInput(BaseModel):
    user_id: str = Field(..., description="User ID")
    booking_history: List[dict] = Field(default_factory=list)
    rated_loads: List[dict] = Field(default_factory=list)
    top_n: int = Field(5, ge=1, le=50)


class RecommendOutput(BaseModel):
    recommendations: list


# ---------------------------------------------------------------------------
# Trust & Risk Scorer
# ---------------------------------------------------------------------------

class TrustScoreInput(BaseModel):
    cancellation_rate: float = Field(..., ge=0, le=1, description="Cancellation rate (0-1)")
    on_time_pct: float = Field(..., ge=0, le=100, description="On-time delivery percentage")
    avg_rating: float = Field(..., ge=1, le=5, description="Average rating (1-5)")
    dispute_count: int = Field(..., ge=0, description="Number of disputes")
    is_verified: bool = Field(..., description="Whether user is verified")


class TrustScoreOutput(BaseModel):
    trust_score: float
    risk_category: str


# ---------------------------------------------------------------------------
# Deadhead Eliminator
# ---------------------------------------------------------------------------

class LocationPoint(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)


class TruckSpecs(BaseModel):
    max_weight_kg: float = Field(..., gt=0)
    max_length_m: float = Field(..., gt=0)
    max_width_m: float = Field(..., gt=0)
    max_height_m: float = Field(..., gt=0)
    fuel_price_inr_per_l: float = Field(100.0, gt=0)
    fuel_efficiency_km_per_l: float = Field(5.0, gt=0)
    toll_per_km_inr: float = Field(1.5, ge=0)
    operating_cost_per_km_inr: float = Field(1.5, ge=0)


class AvailableLoad(BaseModel):
    load_id: str
    origin_lat: float = Field(..., ge=-90, le=90)
    origin_lng: float = Field(..., ge=-180, le=180)
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lng: float = Field(..., ge=-180, le=180)
    weight_kg: float = Field(..., gt=0)
    length_m: float = Field(..., gt=0)
    width_m: float = Field(..., gt=0)
    height_m: float = Field(..., gt=0)
    pickup_deadline: str = Field(..., description="ISO datetime string")
    payment_inr: float = Field(..., gt=0)
    toll_estimate_inr: Optional[float] = Field(None, ge=0)


class DeadheadInput(BaseModel):
    driver_destination: LocationPoint
    truck_specs: TruckSpecs
    arrival_time: str = Field(..., description="ISO datetime string")
    available_loads: List[AvailableLoad]


class DeadheadOutput(BaseModel):
    recommendations: list


# ---------------------------------------------------------------------------
# Mid-Trip Reoptimiser
# ---------------------------------------------------------------------------

class AvailableCapacity(BaseModel):
    weight_kg: float = Field(..., gt=0)
    length_m: float = Field(..., gt=0)
    width_m: float = Field(..., gt=0)
    height_m: float = Field(..., gt=0)


class NearbyLoad(BaseModel):
    load_id: str
    pickup_lat: float = Field(..., ge=-90, le=90)
    pickup_lng: float = Field(..., ge=-180, le=180)
    dropoff_lat: float = Field(..., ge=-90, le=90)
    dropoff_lng: float = Field(..., ge=-180, le=180)
    weight_kg: float = Field(..., gt=0)
    length_m: float = Field(..., gt=0)
    width_m: float = Field(..., gt=0)
    height_m: float = Field(..., gt=0)
    payment_inr: float = Field(..., gt=0)
    pickup_deadline: str = Field(..., description="ISO datetime string")


class MidTripInput(BaseModel):
    current_location: LocationPoint
    remaining_route: List[LocationPoint]
    available_capacity: AvailableCapacity
    nearby_loads: List[NearbyLoad]


class MidTripOutput(BaseModel):
    recommendations: list


# ---------------------------------------------------------------------------
# Schemas — Train Response
# ---------------------------------------------------------------------------

class TrainResponse(BaseModel):
    status: str
    metrics: dict


# ===========================================================================
# Endpoints
# ===========================================================================

@app.get("/")
async def root(_auth=Depends(verify_api_key)):
    return {"message": "Truxify ML Engine is running"}


@app.get("/health")
async def health():
    """Health check endpoint for Docker container orchestration."""
    models = {
        "demand_forecast": model_exists(DEMAND_MODEL_NAME),
        "price_forecast": model_exists(PRICE_MODEL_NAME),
        "driver_profit": model_exists("driver_profit"),
        "trust_scorer": model_exists("trust_scorer"),
        "collaborative_filter": model_exists("collaborative_filter"),
        "eta_predictor": eta_predictor.model is not None,
    }
    non_optional = {k: v for k, v in models.items() if k != 'eta_predictor'}
    all_ready = all(non_optional.values())
    demand_meta = (get_model_meta(DEMAND_MODEL_NAME) or {}).get("training_meta", {})
    return {
        "status": "healthy" if all_ready else "degraded",
        "service": "ml-engine",
        "models": models,
        "models_loaded": len(loaded_models),
        "model_artifact_origin": {
            "demand_forecast": demand_meta.get("source"),
        },
    }


# ---------------------------------------------------------------------------
# Demand Forecast
# ---------------------------------------------------------------------------

@app.post("/predict/demand", response_model=DemandForecastOutput)
async def predict_demand_endpoint(input: DemandForecastInput, _auth=Depends(verify_api_key)):
    features = [
        input.hour,
        input.day_of_week,
        1 if input.day_of_week in (0, 6) else 0,
        input.temperature,
        input.precipitation,
        input.historical_volume,
        input.nearby_drivers,
    ]
    try:
        demand = await run_inference(predict_demand, features)
        if demand is None:
            raise HTTPException(status_code=503, detail="Model not available")
        return DemandForecastOutput(predicted_demand=demand)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Demand prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Prediction failed")


# ---------------------------------------------------------------------------
# Price Prediction
# ---------------------------------------------------------------------------

@app.post("/predict/price", response_model=PricePredictOutput)
async def predict_price_endpoint(input: PricePredictInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            predict_price,
            distance_km=input.distance_km,
            cargo_weight_kg=input.cargo_weight_kg,
            truck_type=input.truck_type,
            route_origin=input.route_origin,
            route_destination=input.route_destination,
            hour_of_day=input.hour_of_day,
            day_of_week=input.day_of_week,
            month=input.month,
            fuel_price=input.fuel_price,
            cargo_type=input.cargo_type,
        )
        if result is None:
            raise HTTPException(
                status_code=503,
                detail="Price model unavailable: no model trained on real historical data. Train via POST /train/price once completed trips exist.",
            )
        return PricePredictOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Price prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Price prediction failed")


# ---------------------------------------------------------------------------
# Bilateral Matcher
# ---------------------------------------------------------------------------

@app.post("/match/bilateral", response_model=BilateralMatchOutput)
async def bilateral_match_endpoint(input: BilateralMatchInput, _auth=Depends(verify_api_key)):
    """
    Two-Sided Bilateral Matcher endpoint.
    Accepts a list of AvailableLoads and Drivers to find the most optimal matches.
    Related Issue: #5552
    """
    try:
        loads = [load.model_dump() for load in input.loads]
        drivers = [driver.model_dump() for driver in input.drivers]
        result = await run_inference(match_bilateral, loads, drivers)
        return BilateralMatchOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Bilateral matching failed: %s", e)
        raise HTTPException(status_code=500, detail="Bilateral matching failed")


# ---------------------------------------------------------------------------
# Driver Profit Predictor
# ---------------------------------------------------------------------------

@app.post("/predict/driver-profit", response_model=DriverProfitOutput)
async def predict_driver_profit_endpoint(input: DriverProfitInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            driver_profit_predictor.predict,
            route_distance=input.route_distance,
            fuel_price=input.fuel_price,
            toll_estimate=input.toll_estimate,
            truck_mileage=input.truck_mileage,
            cargo_weight=input.cargo_weight,
            trip_duration=input.trip_duration,
        )
        if result is None:
            raise HTTPException(status_code=503, detail="Driver profit model unavailable")
        return DriverProfitOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Driver profit prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Driver profit prediction failed")


# ---------------------------------------------------------------------------
# 3D Bin Packer + VRP
# ---------------------------------------------------------------------------

@app.post("/optimise/packing", response_model=PackingOutput)
async def optimise_packing_endpoint(input: PackingInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            optimise_packing,
            packages=[package.model_dump() for package in input.packages],
            truck=input.truck.model_dump(),
            delivery_addresses=[address.model_dump() for address in input.delivery_addresses],
        )
        return PackingOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Packing optimization failed: %s", e)
        raise HTTPException(status_code=500, detail="Packing optimization failed")


# ---------------------------------------------------------------------------
# Collaborative Filter — Load Recommendations
# ---------------------------------------------------------------------------

@app.post("/recommend/loads", response_model=RecommendOutput)
async def recommend_loads_endpoint(input: RecommendLoadsInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            collaborative_filter.recommend_loads,
            user_id=input.user_id,
            booking_history=input.booking_history,
            top_n=input.top_n,
        )
        return RecommendOutput(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Load recommendation failed: %s", e)
        raise HTTPException(status_code=500, detail="Load recommendation failed")


# ---------------------------------------------------------------------------
# Collaborative Filter — Truck Recommendations
# ---------------------------------------------------------------------------

@app.post("/recommend/trucks", response_model=RecommendOutput)
async def recommend_trucks_endpoint(input: RecommendTrucksInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            collaborative_filter.recommend_trucks,
            user_id=input.user_id,
            booking_history=input.booking_history,
            top_n=input.top_n,
        )
        return RecommendOutput(**result)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Truck recommendation failed: %s", e)
        raise HTTPException(status_code=500, detail="Truck recommendation failed")


# ---------------------------------------------------------------------------
# Trust & Risk Scorer
# ---------------------------------------------------------------------------

@app.post("/score/trust", response_model=TrustScoreOutput)
async def trust_score_endpoint(input: TrustScoreInput, _auth=Depends(verify_api_key)):
    try:
        result = await run_inference(
            trust_scorer.predict,
            cancellation_rate=input.cancellation_rate,
            on_time_pct=input.on_time_pct,
            avg_rating=input.avg_rating,
            dispute_count=input.dispute_count,
            is_verified=input.is_verified,
        )
        return TrustScoreOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Trust scoring failed: %s", e)
        raise HTTPException(status_code=500, detail="Trust scoring failed")


# ---------------------------------------------------------------------------
# Deadhead Eliminator
# ---------------------------------------------------------------------------

@app.post("/match/deadhead", response_model=DeadheadOutput)
async def deadhead_endpoint(input: DeadheadInput, _auth=Depends(verify_api_key)):
    try:
        driver_dest = input.driver_destination.model_dump()
        truck_specs = input.truck_specs.model_dump()
        loads = [load.model_dump() for load in input.available_loads]
        result = await run_inference(
            find_return_loads, driver_dest, truck_specs, input.arrival_time, loads
        )
        return DeadheadOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Deadhead matching failed: %s", e)
        raise HTTPException(status_code=500, detail="Deadhead matching failed")


# ---------------------------------------------------------------------------
# Mid-Trip Reoptimiser
# ---------------------------------------------------------------------------

@app.post("/optimise/mid-trip", response_model=MidTripOutput)
async def mid_trip_endpoint(input: MidTripInput, _auth=Depends(verify_api_key)):
    try:
        current_loc = input.current_location.model_dump()
        route = [wp.model_dump() for wp in input.remaining_route]
        capacity = input.available_capacity.model_dump()
        loads = [load.model_dump() for load in input.nearby_loads]
        result = await run_inference(
            find_mid_trip_loads, current_loc, route, capacity, loads
        )
        return MidTripOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Mid-trip reoptimisation failed: %s", e)
        raise HTTPException(status_code=500, detail="Mid-trip reoptimisation failed")


# ---------------------------------------------------------------------------
# Training Endpoints
# ---------------------------------------------------------------------------

@app.post("/train/demand", response_model=TrainResponse)
async def train_demand_endpoint(_auth=Depends(verify_api_key)):
    timeout = float(os.environ.get("ML_TRAINING_TIMEOUT_SECONDS", 300))
    async with get_model_lock(DEMAND_MODEL_NAME):
        try:
            metrics = await run_training_job(
                DEMAND_MODEL_NAME,
                train_demand_forecast_model,
                timeout=timeout,
            )
            return TrainResponse(status="trained", metrics=metrics)
        except TimeoutError:
            raise HTTPException(status_code=504, detail="Demand training timed out")
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Demand training failed: %s", e)
            raise HTTPException(status_code=500, detail="Demand training failed")


# ...
