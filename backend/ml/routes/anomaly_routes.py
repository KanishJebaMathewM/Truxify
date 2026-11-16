from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from typing import Annotated
from anomaly.generation_contract import AdmissionError
from typing import Dict, List, Any, Optional
import numpy as np
import logging
from anomaly.detector import AnomalyDetector

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/anomaly", tags=["Anomaly Detection"])

# Initialize detector
detector = AnomalyDetector()

class DriverData(BaseModel):
    driver_id: str
    speed: float
    acceleration: float
    braking: float
    steering_angle: float
    lane_departure: float
    eye_aspect_ratio: float
    head_pose_x: float
    head_pose_y: float
    heart_rate: int
    stress_level: float

class TransactionData(BaseModel):
    transaction_id: str
    amount: float
    frequency: int
    time_of_day: int
    day_of_week: int
    location_risk: float
    device_risk: float
    ip_risk: float
    pattern_deviation: float

class GPSData(BaseModel):
    driver_id: str
    speed: float
    acceleration: float
    direction_change: float
    route_deviation: float

class TrainRequest(BaseModel):
    model_config = ConfigDict(allow_inf_nan=False)
    data: Dict[str, List[List[List[Annotated[float, Field(strict=True)]]]]]
    epochs: Annotated[int, Field(strict=True, ge=1, le=16)] = 1

@router.post("/detect/driver")
def detect_driver_anomaly(data: DriverData):
    """Detect anomalies in driver behavior"""
    try:
        result = detector.detect_driver_anomaly(data.dict())
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Driver anomaly detection failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/detect/transaction")
def detect_transaction_anomaly(data: TransactionData):
    """Detect anomalies in transactions"""
    try:
        result = detector.detect_transaction_anomaly(data.dict())
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Transaction anomaly detection failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/detect/gps")
def detect_gps_anomaly(data: GPSData):
    """Detect anomalies in GPS data"""
    try:
        result = detector.detect_gps_anomaly(data.dict())
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"GPS anomaly detection failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/train")
def train_models(request: TrainRequest):
    """Train anomaly detection models"""
    try:
        # Convert data
        data = {}
        for name, values in request.data.items():
            data[name] = np.array(values)
        
        # Train models
        results = detector.train_models(data, epochs=request.epochs)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except AdmissionError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/history")
def get_anomaly_history(data_type: Optional[str] = None):
    """Get anomaly detection history"""
    try:
        history = detector.get_anomaly_history(data_type)
        return {
            'success': True,
            'data': history,
            'count': len(history),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"History fetch failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/alerts")
def get_alerts(severity: Optional[str] = None):
    """Get recent alerts"""
    try:
        alerts = detector.get_alerts(severity)
        return {
            'success': True,
            'data': alerts,
            'count': len(alerts),
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Alerts fetch failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/stats")
def get_anomaly_stats():
    """Get anomaly detection statistics"""
    try:
        stats = detector.get_stats()
        return {
            'success': True,
            'data': stats,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Stats fetch failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/threshold/set")
def set_threshold(data_type: str, threshold: float):
    """Set anomaly threshold for a data type"""
    try:
        if data_type in detector.models:
            detector.set_threshold(data_type, threshold)
            return {
                'success': True,
                'message': f'Threshold set to {threshold} for {data_type}',
                'timestamp': datetime.now().isoformat()
            }
        else:
            raise HTTPException(status_code=404, detail=f"Data type {data_type} not found")
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
    except Exception as e:
        logger.error(f"Threshold setting failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.get("/threshold/{data_type}")
def get_threshold(data_type: str):
    """Get anomaly threshold for a data type"""
    try:
        if data_type in detector.models:
            threshold = detector.get_threshold(data_type)
            return {
                'success': True,
                'data': {
                    'data_type': data_type,
                    'threshold': threshold
                },
                'timestamp': datetime.now().isoformat()
            }
        else:
            raise HTTPException(status_code=404, detail=f"Data type {data_type} not found")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Threshold fetch failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")