
"""FastAPI router for the Logistics Digital Twin platform."""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from twin_model import (
    DigitalTwin,
    DigitalTwinOptimizer,
    LogisticsAsset,
    LogisticsEvent,
    PredictiveAnalytics,
    SimulationEngine,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/digital-twin",
    tags=["Digital Twin"],
)

# ---------------------------------------------------------------------------
# Shared Digital Twin services
# ---------------------------------------------------------------------------

twin = DigitalTwin()
sim_engine = SimulationEngine(twin)
predictive = PredictiveAnalytics(twin)
optimizer = DigitalTwinOptimizer(twin)


# ---------------------------------------------------------------------------
# Request models
# ---------------------------------------------------------------------------

class AssetRequest(BaseModel):
    id: str = Field(..., min_length=1, max_length=100)
    type: str = Field(..., min_length=1, max_length=50)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    status: str = Field(..., min_length=1, max_length=50)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class EventRequest(BaseModel):
    type: str = Field(..., min_length=1, max_length=50)
    asset_id: str = Field(..., min_length=1, max_length=100)
    lat: float = Field(..., ge=-90, le=90)
    lng: float = Field(..., ge=-180, le=180)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ScenarioRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    params: Dict[str, Any] = Field(default_factory=dict)


class AssetUpdateRequest(BaseModel):
    updates: Dict[str, Any] = Field(default_factory=dict)


class ResourceAllocationRequest(BaseModel):
    resources: Dict[str, Any] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def utc_timestamp() -> str:
    """Return the current timezone-aware UTC timestamp."""
    return datetime.now(timezone.utc).isoformat()


def validate_non_empty(value: str, field_name: str) -> str:
    """Validate and normalize a required string."""
    if not isinstance(value, str) or not value.strip():
        raise HTTPException(
            status_code=400,
            detail=f"{field_name} cannot be empty",
        )
    return value.strip()


def handle_unexpected_error(
    operation: str,
    exc: Exception,
) -> HTTPException:
    """Log internal errors without exposing implementation details."""
    logger.exception("%s failed", operation)

    return HTTPException(
        status_code=500,
        detail=f"{operation} failed",
    )


# ---------------------------------------------------------------------------
# Asset endpoints
# ---------------------------------------------------------------------------

@router.post("/asset/add")
async def add_asset(request: AssetRequest):
    try:
        asset_id = validate_non_empty(request.id, "id")
        asset_type = validate_non_empty(request.type, "type")
        asset_status = validate_non_empty(request.status, "status")

        asset = LogisticsAsset(
            id=asset_id,
            type=asset_type,
            location={
                "lat": request.lat,
                "lng": request.lng,
            },
            status=asset_status,
            metadata=request.metadata,
        )

        twin.add_asset(asset)

        return {
            "success": True,
            "data": {
                "id": asset.id,
            },
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Add asset", exc) from exc


@router.post("/asset/update")
async def update_asset(
    asset_id: str = Query(..., min_length=1, max_length=100),
    request: AssetUpdateRequest = ...,
):
    asset_id = validate_non_empty(asset_id, "asset_id")

    if not request.updates:
        raise HTTPException(
            status_code=400,
            detail="At least one update field is required",
        )

    try:
        result = twin.update_asset(
            asset_id,
            request.updates,
        )

        if result is None or result is False:
            raise HTTPException(
                status_code=404,
                detail=f"Asset '{asset_id}' not found",
            )

        return {
            "success": True,
            "data": {
                "updated": result,
            },
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Update asset", exc) from exc


@router.get("/asset/{asset_id}")
async def get_asset(
    asset_id: str,
):
    asset_id = validate_non_empty(asset_id, "asset_id")

    try:
        state = twin.get_asset_state(asset_id)

        if state is None:
            raise HTTPException(
                status_code=404,
                detail=f"Asset '{asset_id}' not found",
            )

        return {
            "success": True,
            "data": state,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Get asset", exc) from exc


# ---------------------------------------------------------------------------
# Event endpoints
# ---------------------------------------------------------------------------

@router.post("/event/add")
async def add_event(request: EventRequest):
    try:
        event_type = validate_non_empty(request.type, "type")
        asset_id = validate_non_empty(request.asset_id, "asset_id")

        # Generate ID and timestamp from the same UTC datetime.
        now = datetime.now(timezone.utc)

        event_id = (
            f"event_{now.strftime('%Y%m%d%H%M%S%f')}"
        )

        event = LogisticsEvent(
            id=event_id,
            type=event_type,
            timestamp=now,
            asset_id=asset_id,
            location={
                "lat": request.lat,
                "lng": request.lng,
            },
            metadata=request.metadata,
        )

        twin.add_event(event)

        return {
            "success": True,
            "data": {
                "id": event.id,
            },
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Add event", exc) from exc


@router.get("/events")
async def get_events(
    asset_id: Optional[str] = Query(
        default=None,
        min_length=1,
        max_length=100,
    ),
    limit: int = Query(
        default=100,
        ge=1,
        le=1000,
    ),
):
    if asset_id is not None:
        asset_id = validate_non_empty(asset_id, "asset_id")

    try:
        events = twin.get_events(
            asset_id,
            limit,
        )

        return {
            "success": True,
            "data": events,
            "count": len(events),
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Get events", exc) from exc


# ---------------------------------------------------------------------------
# Digital Twin state
# ---------------------------------------------------------------------------

@router.get("/state")
async def get_state():
    try:
        state = twin.get_state()

        return {
            "success": True,
            "data": state,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Get state", exc) from exc


# ---------------------------------------------------------------------------
# Scenario endpoints
# ---------------------------------------------------------------------------

@router.post("/scenario/create")
async def create_scenario(request: ScenarioRequest):
    try:
        scenario_name = validate_non_empty(
            request.name,
            "name",
        )

        scenario_id = sim_engine.create_scenario(
            scenario_name,
            request.params,
        )

        return {
            "success": True,
            "data": {
                "scenario_id": scenario_id,
            },
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Create scenario", exc) from exc


@router.post("/scenario/run")
async def run_scenario(
    scenario_id: str = Query(..., min_length=1),
    duration: int = Query(
        default=3600,
        ge=1,
        le=86400,
    ),
):
    scenario_id = validate_non_empty(
        scenario_id,
        "scenario_id",
    )

    try:
        result = sim_engine.run_simulation(
            scenario_id,
            duration,
        )

        return {
            "success": True,
            "data": {
                "metrics": result.metrics,
                "events_count": len(result.events),
                "recommendations": result.recommendations,
                "duration_ms": result.duration,
            },
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Run scenario", exc) from exc


# ---------------------------------------------------------------------------
# Prediction endpoints
# ---------------------------------------------------------------------------

@router.post("/predict/delays")
async def predict_delays(
    asset_id: str = Query(..., min_length=1, max_length=100),
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
    ),
):
    asset_id = validate_non_empty(asset_id, "asset_id")

    try:
        prediction = predictive.predict_delays(
            asset_id,
            hours,
        )

        return {
            "success": True,
            "data": prediction,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Predict delays", exc) from exc


@router.post("/predict/arrival")
async def predict_arrival(
    asset_id: str = Query(..., min_length=1, max_length=100),
):
    asset_id = validate_non_empty(asset_id, "asset_id")

    try:
        prediction = predictive.predict_arrival_time(
            asset_id
        )

        return {
            "success": True,
            "data": prediction,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Predict arrival", exc) from exc


@router.post("/predict/demand")
async def predict_demand(
    lat: float = Query(..., ge=-90, le=90),
    lng: float = Query(..., ge=-180, le=180),
    hours: int = Query(
        default=24,
        ge=1,
        le=168,
    ),
):
    try:
        prediction = predictive.predict_demand(
            {
                "lat": lat,
                "lng": lng,
            },
            hours,
        )

        return {
            "success": True,
            "data": prediction,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Predict demand", exc) from exc


# ---------------------------------------------------------------------------
# Optimization endpoints
# ---------------------------------------------------------------------------

@router.post("/optimize/routes")
async def optimize_routes(asset_ids: List[str]):
    if not asset_ids:
        raise HTTPException(
            status_code=400,
            detail="At least one asset_id is required",
        )

    try:
        cleaned_asset_ids = []

        for asset_id in asset_ids:
            cleaned_id = validate_non_empty(
                asset_id,
                "asset_id",
            )

            if cleaned_id not in cleaned_asset_ids:
                cleaned_asset_ids.append(cleaned_id)

        result = optimizer.optimize_routes(
            cleaned_asset_ids
        )

        return {
            "success": True,
            "data": result,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Optimize routes", exc) from exc


@router.post("/optimize/resources")
async def optimize_resources(
    request: ResourceAllocationRequest,
):
    try:
        result = optimizer.resource_allocation(
            request.resources
        )

        return {
            "success": True,
            "data": result,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Optimize resources", exc) from exc


# ---------------------------------------------------------------------------
# Statistics
# ---------------------------------------------------------------------------

@router.get("/stats")
async def get_stats():
    try:
        stats = {
            "total_assets": len(twin.assets),
            "total_events": len(twin.events),
            "total_simulations": len(twin.simulations),
            "assets_by_type": {},
            "events_by_type": {},
        }

        for asset in twin.assets.values():
            asset_type = asset.type

            stats["assets_by_type"][asset_type] = (
                stats["assets_by_type"].get(asset_type, 0) + 1
            )

        for event in twin.events:
            event_type = event.type

            stats["events_by_type"][event_type] = (
                stats["events_by_type"].get(event_type, 0) + 1
            )

        return {
            "success": True,
            "data": stats,
            "timestamp": utc_timestamp(),
        }

    except HTTPException:
        raise
    except Exception as exc:
        raise handle_unexpected_error("Get stats", exc) from exc

