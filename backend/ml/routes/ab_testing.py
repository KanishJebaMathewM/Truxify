from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from services.ab_testing import ABTestModel
from app.models.eta_prediction import eta_predictor
import os
import logging

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ab-testing", tags=["A/B Testing"])

# Initialize AB test service
db_url = os.getenv('DATABASE_URL', 'sqlite:///./ab_testing.db')
ab_service = ABTestModel(db_url)

class PredictionRequest(BaseModel):
    order_id: str
    features: Dict[str, Any]
    request_id: Optional[str] = None

class MetricsRequest(BaseModel):
    test_id: str
    model_version: str
    metrics: Dict[str, float]
    request_id: str


def _feature(request, key, fallback, cast, minimum=None):
    """Extract a single feature from the request, applying a fallback or 422."""
    raw = request.features.get(key)
    if raw is None:
        if fallback is not None:
            return fallback
        raise ValueError(f"Missing required feature: {key}")
    try:
        parsed = cast(raw)
    except (TypeError, ValueError):
        raise ValueError(f"Invalid feature '{key}': {raw!r}")
    if minimum is not None and parsed < minimum:
        raise ValueError(f"Feature '{key}' must be >= {minimum}")
    return parsed


@router.post("/predict")
async def predict_with_ab(request: PredictionRequest):
    """Get a real ETA prediction routed through the A/B service.

    Runs the same trained ETA model used by /eta/predict, so the result
    varies with the supplied features instead of returning a constant.
    """
    try:
        # Get model routing decision
        routing = ab_service.get_model_for_request(request.request_id or 'unknown')

        distance = _feature(request, 'distance', None, float, minimum=0)
        time_of_day = _feature(request, 'time_of_day', datetime.now().hour, int)
        day_of_week = _feature(request, 'day_of_week', datetime.now().weekday(), int)
        route_type = request.features.get('route_type', request.features.get('route', 'highway'))
        historical_speed = _feature(request, 'historical_speed', 50.0, float, minimum=0)

        result = eta_predictor.predict(
            distance,
            time_of_day,
            day_of_week,
            route_type,
            historical_speed,
        )

        interval = result['confidence_interval']
        confidence = max(0.0, round(1.0 - (interval['max'] - interval['min']) / interval['max'], 4))

        return {
            'order_id': request.order_id,
            'predicted_eta': result['eta_minutes'],
            'confidence': confidence,
            'routing': routing,
            'timestamp': datetime.utcnow().isoformat()
        }
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/metrics")
async def log_metrics(metrics: MetricsRequest):
    """Log model performance metrics"""
    try:
        ab_service.log_metrics(
            metrics.test_id,
            metrics.model_version,
            metrics.metrics,
            metrics.request_id
        )
        return {'status': 'success', 'message': 'Metrics logged'}
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/evaluate/{test_id}")
async def evaluate_test(test_id: str):
    """Evaluate A/B test results"""
    try:
        results = ab_service.evaluate_test(test_id)
        return results
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/rollback/{test_id}")
async def trigger_rollback(test_id: str):
    """Trigger manual rollback"""
    try:
        result = ab_service.trigger_rollback(test_id)
        return result
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/status")
async def get_ab_status():
    """Get A/B testing status (non-sensitive metadata only).

    Internal knobs such as traffic_split and threshold are intentionally
    omitted from the public response.
    """
    active_test = ab_service.get_active_test()
    return {
        'status': 'active',
        'active_test': active_test,
        'timestamp': datetime.utcnow().isoformat()
    }