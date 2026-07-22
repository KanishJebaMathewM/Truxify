import asyncio
import hmac
import logging
import os
import time
import numpy as np
from datetime import datetime, timedelta
from fastapi import FastAPI, HTTPException, Header, Depends
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List, Optional
from app.models.eta_prediction import eta_predictor

from app.models.demand_forecast import (
    predict_demand,
    train_demand_forecast_model,
    FEATURE_NAMES,
)
from app.models.price_prediction import predict_price, train_price_model
from app.models.bilateral_matcher import match_bilateral
from app.models.driver_profit import driver_profit_predictor
from app.models.bin_packing import optimise_packing
from app.models.collaborative_filter import collaborative_filter
from app.models.trust_scorer import trust_scorer
from app.models.deadhead_eliminator import find_return_loads
from app.models.mid_trip_reoptimiser import find_mid_trip_loads
from app.models.base import model_exists
from app.models.demand_forecast import MODEL_NAME as DEMAND_MODEL_NAME
from app.models.price_prediction import MODEL_NAME as PRICE_MODEL_NAME
from routes import federated_routes

# ============================================================================
# 🆕 REAL-TIME TRAFFIC ETA IMPORTS
# ============================================================================
from services.traffic_pipeline import TrafficPipeline

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Track loaded models for health reporting
loaded_models: set[str] = set()

# ============================================================================
# 🆕 TRAFFIC PIPELINE INITIALIZATION
# ============================================================================
db_url = os.getenv('DATABASE_URL', 'sqlite:///./traffic.db')
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
traffic_pipeline = TrafficPipeline(db_url, redis_url)


async def verify_api_key(x_api_key: str = Header(None, alias="X-API-Key")):
    ml_api_key = os.environ.get("ML_API_KEY")
    if not ml_api_key:
        logger.warning("ML_API_KEY not set - ML engine is unavailable (503)")
        raise HTTPException(status_code=503, detail="ML engine not configured: missing ML_API_KEY")
    if not x_api_key or not hmac.compare_digest(x_api_key, ml_api_key):
        raise HTTPException(status_code=401, detail="Unauthorized")


app = FastAPI(
    title="Truxify ML Engine",
    description="ML prediction service for load matching, pricing, ETA, and route optimization",
    version="1.0.0",
    docs_url="/docs",      # Swagger UI at /docs
    redoc_url="/redoc", 
)



# Add federated routes
app.include_router(federated_routes.router)

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
    from .models.base import preload_all_models
    logger.info("ML Engine starting, pre-loading models...")
    persisted_models = await preload_all_models()
    loaded_models.update(persisted_models)
    if eta_predictor.model is not None:
        loaded_models.add("eta_prediction")
    if traffic_pipeline.model is not None:
        loaded_models.add("traffic_eta")
    logger.info("ML Engine startup complete — loaded: %s", sorted(loaded_models))


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
# 🆕 Schemas — Real-Time Traffic ETA Prediction
# ---------------------------------------------------------------------------

class ETAPredictInput(BaseModel):
    route_distance: float = Field(..., gt=0)
    time_of_day: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6)
    route_type: str = Field(..., description="highway or city")
    historical_speed: float = Field(..., gt=0)


class ETAPredictOutput(BaseModel):
    eta_minutes: float
    confidence_interval: dict


# 🆕 Enhanced ETA with Traffic
class TrafficETARequest(BaseModel):
    order_id: str
    source_lat: float = Field(..., ge=-90, le=90)
    source_lng: float = Field(..., ge=-180, le=180)
    dest_lat: float = Field(..., ge=-90, le=90)
    dest_lng: float = Field(..., ge=-180, le=180)


class TrafficETAResponse(BaseModel):
    order_id: str
    eta_seconds: Optional[float] = None
    eta_minutes: Optional[float] = None
    eta_string: Optional[str] = None
    traffic_speed: Optional[float] = None
    congestion_level: Optional[float] = None
    timestamp: str


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
    preferred_dest_lat: float = Field(0.0, ge=-90, le=90)
    preferred_dest_lng: float = Field(0.0, ge=-180, le=180)
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
        "traffic_eta": traffic_pipeline.model is not None,
    }
    non_optional = {k: v for k, v in models.items() if k != 'eta_predictor'}
    all_ready = all(non_optional.values())
    return {
        "status": "healthy" if all_ready else "degraded",
        "service": "ml-engine",
        "models": models,
        "models_loaded": len(loaded_models),
    }


# ---------------------------------------------------------------------------
# Demand Forecast
# ---------------------------------------------------------------------------

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


# ---------------------------------------------------------------------------
# Price Prediction
# ---------------------------------------------------------------------------

@app.post("/predict/price", response_model=PricePredictOutput)
async def predict_price_endpoint(input: PricePredictInput, _auth=Depends(verify_api_key)):
    try:
        result = predict_price(
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
        return PricePredictOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Price prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Price prediction failed")


# ---------------------------------------------------------------------------
# 🆕 Real-Time Traffic ETA Prediction
# ---------------------------------------------------------------------------

@app.post("/eta/predict", response_model=TrafficETAResponse)
async def predict_traffic_eta(request: TrafficETARequest, _auth=Depends(verify_api_key)):
    """Predict ETA with real-time traffic data"""
    try:
        # Ingest traffic data
        traffic_data = await traffic_pipeline.ingest_traffic_data(
            f"order_{request.order_id}",
            {'lat': request.source_lat, 'lng': request.source_lng},
            {'lat': request.dest_lat, 'lng': request.dest_lng}
        )
        
        if traffic_data:
            # Get prediction
            features = np.array([[
                traffic_data.traffic_speed,
                traffic_data.free_flow_speed,
                traffic_data.congestion_level,
                datetime.now().hour,
                datetime.now().weekday()
            ]])
            
            eta_seconds = traffic_pipeline.predict_eta(features)
            
            if eta_seconds:
                return TrafficETAResponse(
                    order_id=request.order_id,
                    eta_seconds=eta_seconds,
                    eta_minutes=eta_seconds / 60,
                    eta_string=str(timedelta(seconds=int(eta_seconds))),
                    traffic_speed=traffic_data.traffic_speed,
                    congestion_level=traffic_data.congestion_level,
                    timestamp=datetime.now().isoformat()
                )
        
        raise HTTPException(status_code=500, detail="ETA prediction failed")
        
    except Exception as e:
        logger.error("ETA prediction failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/eta/update/{order_id}")
async def update_eta_realtime(order_id: str, _auth=Depends(verify_api_key)):
    """Update ETA in real-time during trip"""
    try:
        # Get current location from tracking (simulated)
        current_location = {'lat': 28.6139, 'lng': 77.2090}
        destination = {'lat': 28.7041, 'lng': 77.1025}
        
        result = await traffic_pipeline.update_eta_realtime(
            order_id,
            current_location,
            destination
        )
        
        if result:
            return {
                'order_id': order_id,
                'data': result,
                'timestamp': datetime.now().isoformat()
            }
        
        raise HTTPException(status_code=404, detail="Order not found")
        
    except Exception as e:
        logger.error("ETA update failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/eta/traffic/{route_id}")
async def get_traffic_data(route_id: str, _auth=Depends(verify_api_key)):
    """Get real-time traffic data for a route"""
    try:
        traffic = await traffic_pipeline.get_real_time_traffic(route_id)
        if traffic:
            return {
                'route_id': route_id,
                'data': traffic,
                'timestamp': datetime.now().isoformat()
            }
        return {
            'route_id': route_id,
            'data': None,
            'message': 'No traffic data available'
        }
    except Exception as e:
        logger.error("Traffic data fetch failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/eta/forecast/{route_id}")
async def get_traffic_forecast(route_id: str, hours: int = Field(1, ge=1, le=24), _auth=Depends(verify_api_key)):
    """Get traffic forecast for next N hours"""
    try:
        forecast = await traffic_pipeline.get_traffic_forecast(route_id, hours)
        return {
            'route_id': route_id,
            'data': forecast,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error("Traffic forecast failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/eta/train")
async def train_traffic_model(_auth=Depends(verify_api_key)):
    """Trigger model retraining"""
    try:
        traffic_pipeline.train_model(epochs=50)
        return {
            'status': 'success',
            'message': 'Model trained successfully',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error("Model training failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# ETA Prediction (Legacy - Keep for backward compatibility)
# ---------------------------------------------------------------------------

@app.post("/predict/eta", response_model=ETAPredictOutput)
async def predict_eta_endpoint(input: ETAPredictInput, _auth=Depends(verify_api_key)):
    try:
        result = eta_predictor.predict(
            distance=input.route_distance,
            time_of_day=input.time_of_day,
            day_of_week=input.day_of_week,
            route_type=input.route_type,
            historical_speed=input.historical_speed,
        )
        return ETAPredictOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("ETA prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="ETA prediction failed")


# ---------------------------------------------------------------------------
# Bilateral Matcher
# ---------------------------------------------------------------------------

@app.post("/match/bilateral", response_model=BilateralMatchOutput)
async def bilateral_match_endpoint(input: BilateralMatchInput, _auth=Depends(verify_api_key)):
    try:
        loads = [load.model_dump() for load in input.loads]
        drivers = [driver.model_dump() for driver in input.drivers]
        result = match_bilateral(loads, drivers)
        return BilateralMatchOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Bilateral matching failed: %s", e)
        raise HTTPException(status_code=500, detail="Matching failed")


# ---------------------------------------------------------------------------
# Driver Profit Predictor
# ---------------------------------------------------------------------------

@app.post("/predict/driver-profit", response_model=DriverProfitOutput)
async def predict_driver_profit_endpoint(input: DriverProfitInput, _auth=Depends(verify_api_key)):
    try:
        result = driver_profit_predictor.predict(
            route_distance=input.route_distance,
            fuel_price=input.fuel_price,
            toll_estimate=input.toll_estimate,
            truck_mileage=input.truck_mileage,
            cargo_weight=input.cargo_weight,
            trip_duration=input.trip_duration,
        )
        return DriverProfitOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Driver profit prediction failed: %s", e)
        raise HTTPException(status_code=500, detail="Driver profit prediction failed")


# ---------------------------------------------------------------------------
# 3D Bin Packer + VRP
# ---------------------------------------------------------------------------

@app.post("/optimise/packing", response_model=PackingOutput)
async def packing_endpoint(input: PackingInput, _auth=Depends(verify_api_key)):
    try:
        packages = [pkg.model_dump() for pkg in input.packages]
        truck = input.truck.model_dump()
        addresses = [addr.model_dump() for addr in input.delivery_addresses]
        result = optimise_packing(packages, truck, addresses)
        return PackingOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Packing optimisation failed: %s", e)
        raise HTTPException(status_code=500, detail="Packing optimisation failed")


# ---------------------------------------------------------------------------
# Collaborative Filter — Load Recommendations
# ---------------------------------------------------------------------------

@app.post("/recommend/loads", response_model=RecommendOutput)
async def recommend_loads_endpoint(input: RecommendLoadsInput, _auth=Depends(verify_api_key)):
    try:
        result = collaborative_filter.recommend_loads(
            user_id=input.user_id,
            booking_history=input.booking_history,
            rated_drivers=input.rated_drivers,
            top_n=input.top_n,
        )
        return RecommendOutput(**result)
    except Exception as e:
        logger.error("Load recommendation failed: %s", e)
        raise HTTPException(status_code=500, detail="Load recommendation failed")


# ---------------------------------------------------------------------------
# Collaborative Filter — Truck Recommendations
# ---------------------------------------------------------------------------

@app.post("/recommend/trucks", response_model=RecommendOutput)
async def recommend_trucks_endpoint(input: RecommendTrucksInput, _auth=Depends(verify_api_key)):
    try:
        result = collaborative_filter.recommend_trucks(
            user_id=input.user_id,
            booking_history=input.booking_history,
            rated_loads=input.rated_loads,
            top_n=input.top_n,
        )
        return RecommendOutput(**result)
    except Exception as e:
        logger.error("Truck recommendation failed: %s", e)
        raise HTTPException(status_code=500, detail="Truck recommendation failed")


# ---------------------------------------------------------------------------
# Trust & Risk Scorer
# ---------------------------------------------------------------------------

@app.post("/score/trust", response_model=TrustScoreOutput)
async def trust_score_endpoint(input: TrustScoreInput, _auth=Depends(verify_api_key)):
    try:
        result = trust_scorer.predict(
            cancellation_rate=input.cancellation_rate,
            on_time_pct=input.on_time_pct,
            avg_rating=input.avg_rating,
            dispute_count=input.dispute_count,
            is_verified=input.is_verified,
        )
        return TrustScoreOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
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
        result = find_return_loads(driver_dest, truck_specs, input.arrival_time, loads)
        return DeadheadOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
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
        result = find_mid_trip_loads(current_loc, route, capacity, loads)
        return MidTripOutput(**result)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error("Mid-trip reoptimisation failed: %s", e)
        raise HTTPException(status_code=500, detail="Mid-trip reoptimisation failed")


# ---------------------------------------------------------------------------
# Training Endpoints
# ---------------------------------------------------------------------------

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


@app.post("/train/price", response_model=TrainResponse)
async def train_price_endpoint(_auth=Depends(verify_api_key)):
    timeout = int(os.environ.get("ML_TRAINING_TIMEOUT_SECONDS", 300))
    try:
        metrics = await asyncio.wait_for(
            asyncio.to_thread(train_price_model),
            timeout=timeout,
        )
        return TrainResponse(status="success", metrics=metrics)
    except asyncio.TimeoutError:
        logger.error("Price model training timed out after %d seconds", timeout)
        raise HTTPException(status_code=504, detail="Training timed out")
    except Exception as e:
        logger.error("Price model training failed: %s", e)
        raise HTTPException(status_code=500, detail="Training failed")


# ---------------------------------------------------------------------------
# Model Registry
# ---------------------------------------------------------------------------

@app.get("/models")
async def list_models(_auth=Depends(verify_api_key)):
    from app.models.base import MODEL_STORAGE_DIR
    import os, json
    models = []
    if os.path.isdir(MODEL_STORAGE_DIR):
        for f in os.listdir(MODEL_STORAGE_DIR):
            if f.endswith("_meta.json"):
                with open(os.path.join(MODEL_STORAGE_DIR, f)) as fh:
                    models.append(json.load(fh))
    return {"models": models}