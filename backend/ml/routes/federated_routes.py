from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from federated.federated_server import FederatedServer
from federated.federated_client import FederatedClient
import os
import logging

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/federated", tags=["Federated Learning"])

# Initialize server
redis_url = os.getenv('REDIS_URL', 'redis://localhost:6379')
server = FederatedServer(redis_url)

class ClientData(BaseModel):
    client_id: str
    data: Optional[List[List[float]]] = None
    labels: Optional[List[int]] = None

class TrainingRequest(BaseModel):
    client_id: str
    epochs: int = 5
    rounds: int = 10

@router.post("/server/start-round")
async def start_round():
    """Start new federated learning round"""
    try:
        result = server.start_round()
        if result:
            return {
                'success': True,
                'data': result
            }
        return {
            'success': False,
            'message': 'Not enough clients available'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/server/aggregate")
async def aggregate_weights():
    """Force weight aggregation"""
    try:
        server._aggregate_weights()
        return {
            'success': True,
            'message': 'Weights aggregated successfully'
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/server/stats")
async def get_server_stats():
    """Get server statistics"""
    try:
        stats = server.get_model_stats()
        return {
            'success': True,
            'data': stats
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/server/model")
async def get_global_model():
    """Get global model weights"""
    try:
        weights = server.get_global_model()
        return {
            'success': True,
            'data': weights
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/client/register")
async def register_client(request: TrainingRequest):
    """Register a new client"""
    try:
        client = FederatedClient(request.client_id, redis_url)
        return {
            'success': True,
            'message': f'Client {request.client_id} registered',
            'client_id': request.client_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/client/train")
async def train_client(request: TrainingRequest):
    """Train client locally"""
    try:
        client = FederatedClient(request.client_id, redis_url)
        
        # Simulate local data
        data, labels = client.simulate_driver_behavior()
        
        # Train
        results = client.start_federated_learning(
            rounds=request.rounds,
            epochs_per_round=request.epochs
        )
        
        return {
            'success': True,
            'data': results,
            'client_id': request.client_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/client/participate")
async def participate_in_round(request: TrainingRequest):
    """Participate in current round"""
    try:
        client = FederatedClient(request.client_id, redis_url)
        
        # Get local data
        data, labels = client.simulate_driver_behavior()
        
        # Participate
        result = client.participate_in_round(
            data, labels,
            epochs=request.epochs
        )
        
        return {
            'success': True,
            'data': result,
            'client_id': request.client_id
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/clients")
async def get_clients():
    """Get all registered clients"""
    try:
        clients = server._get_available_clients()
        return {
            'success': True,
            'data': clients,
            'count': len(clients)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))