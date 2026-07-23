from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import datetime
import logging
from twin_model import DigitalTwin, LogisticsAsset, LogisticsEvent, SimulationEngine, PredictiveAnalytics, DigitalTwinOptimizer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/digital-twin", tags=["Digital Twin"])

twin = DigitalTwin()
sim_engine = SimulationEngine(twin)
predictive = PredictiveAnalytics(twin)
optimizer = DigitalTwinOptimizer(twin)

class AssetRequest(BaseModel):
    id: str
    type: str
    lat: float
    lng: float
    status: str
    metadata: Optional[Dict] = {}

class EventRequest(BaseModel):
    type: str
    asset_id: str
    lat: float
    lng: float
    metadata: Optional[Dict] = {}

class ScenarioRequest(BaseModel):
    name: str
    params: Dict

@router.post("/asset/add")
async def add_asset(request: AssetRequest):
    try:
        asset = LogisticsAsset(
            id=request.id,
            type=request.type,
            location={'lat': request.lat, 'lng': request.lng},
            status=request.status,
            metadata=request.metadata
        )
        twin.add_asset(asset)
        
        return {
            'success': True,
            'data': {'id': asset.id},
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Add asset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/asset/update")
async def update_asset(asset_id: str, updates: Dict):
    try:
        result = twin.update_asset(asset_id, updates)
        
        return {
            'success': result,
            'data': {'updated': result},
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Update asset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/event/add")
async def add_event(request: EventRequest):
    try:
        event = LogisticsEvent(
            id=f"event_{int(datetime.now().timestamp())}",
            type=request.type,
            timestamp=datetime.now(),
            asset_id=request.asset_id,
            location={'lat': request.lat, 'lng': request.lng},
            metadata=request.metadata
        )
        twin.add_event(event)
        
        return {
            'success': True,
            'data': {'id': event.id},
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Add event failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/state")
async def get_state():
    try:
        state = twin.get_state()
        
        return {
            'success': True,
            'data': state,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Get state failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/asset/{asset_id}")
async def get_asset(asset_id: str):
    try:
        state = twin.get_asset_state(asset_id)
        
        return {
            'success': True,
            'data': state,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Get asset failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/events")
async def get_events(asset_id: Optional[str] = None, limit: int = 100):
    try:
        events = twin.get_events(asset_id, limit)
        
        return {
            'success': True,
            'data': events,
            'count': len(events),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Get events failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/scenario/create")
async def create_scenario(request: ScenarioRequest):
    try:
        scenario_id = sim_engine.create_scenario(request.name, request.params)
        
        return {
            'success': True,
            'data': {'scenario_id': scenario_id},
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Create scenario failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/scenario/run")
async def run_scenario(scenario_id: str, duration: int = 3600):
    try:
        result = sim_engine.run_simulation(scenario_id, duration)
        
        return {
            'success': True,
            'data': {
                'metrics': result.metrics,
                'events_count': len(result.events),
                'recommendations': result.recommendations,
                'duration_ms': result.duration
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Run scenario failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict/delays")
async def predict_delays(asset_id: str, hours: int = 24):
    try:
        prediction = predictive.predict_delays(asset_id, hours)
        
        return {
            'success': True,
            'data': prediction,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Predict delays failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict/arrival")
async def predict_arrival(asset_id: str):
    try:
        prediction = predictive.predict_arrival_time(asset_id)
        
        return {
            'success': True,
            'data': prediction,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Predict arrival failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict/demand")
async def predict_demand(lat: float, lng: float, hours: int = 24):
    try:
        prediction = predictive.predict_demand({'lat': lat, 'lng': lng}, hours)
        
        return {
            'success': True,
            'data': prediction,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Predict demand failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize/routes")
async def optimize_routes(asset_ids: List[str]):
    try:
        result = optimizer.optimize_routes(asset_ids)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Optimize routes failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize/resources")
async def optimize_resources(resources: Dict):
    try:
        result = optimizer.resource_allocation(resources)
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Optimize resources failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/stats")
async def get_stats():
    try:
        stats = {
            'total_assets': len(twin.assets),
            'total_events': len(twin.events),
            'total_simulations': len(twin.simulations),
            'assets_by_type': {},
            'events_by_type': {}
        }
        
        for asset in twin.assets.values():
            stats['assets_by_type'][asset.type] = stats['assets_by_type'].get(asset.type, 0) + 1
        
        for event in twin.events:
            stats['events_by_type'][event.type] = stats['events_by_type'].get(event.type, 0) + 1
        
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Get stats failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))