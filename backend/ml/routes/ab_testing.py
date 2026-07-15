from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Dict, Any, Optional
from services.ab_testing import ABTestModel
import os

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

@router.post("/predict")
async def predict_with_ab(request: PredictionRequest):
    """Get prediction with A/B routing"""
    try:
        # Get model routing decision
        routing = ab_service.get_model_for_request(request.request_id or 'unknown')
        
        # Here you would call the actual prediction
        # For demo, return simulated prediction
        prediction = {
            'order_id': request.order_id,
            'predicted_eta': 4.5,
            'confidence': 0.85,
            'routing': routing,
            'timestamp': datetime.utcnow().isoformat()
        }
        
        return prediction
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

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
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/evaluate/{test_id}")
async def evaluate_test(test_id: str):
    """Evaluate A/B test results"""
    try:
        results = ab_service.evaluate_test(test_id)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/rollback/{test_id}")
async def trigger_rollback(test_id: str):
    """Trigger manual rollback"""
    try:
        result = ab_service.trigger_rollback(test_id)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
async def get_ab_status():
    """Get A/B testing status"""
    active_test = ab_service.get_active_test()
    return {
        'status': 'active',
        'active_test': active_test,
        'traffic_split': ab_service.traffic_split,
        'threshold': ab_service.threshold,
        'timestamp': datetime.utcnow().isoformat()
    }