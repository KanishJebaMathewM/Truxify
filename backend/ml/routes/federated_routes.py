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

_clients: Dict[str, FederatedClient] = {}

def get_or_create_client(client_id: str) -> FederatedClient:
    """Retrieve existing client instance or create and register a new one."""
    if client_id not in _clients:
        _clients[client_id] = FederatedClient(client_id, server.redis if server.redis is not None else redis_url)
    return _clients[client_id]

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/server/aggregate")
async def aggregate_weights():
    """Force weight aggregation"""
    try:
        # First drain any pending client updates from Redis
        server.drain_pending_client_updates()

        if not server.client_weights:
            raise HTTPException(
                status_code=400,
                detail="No client weights available for aggregation"
            )

        num_clients = len(server.client_weights)
        res = server._aggregate_weights()
        if not res:
            raise HTTPException(
                status_code=400,
                detail="No client weights available for aggregation"
            )

        return {
            'success': True,
            'message': 'Weights aggregated successfully',
            'data': {
                'round': server.round,
                'clients_aggregated': num_clients
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/client/register")
async def register_client(request: TrainingRequest):
    """Register a new client"""
    try:
        client = get_or_create_client(request.client_id)
        return {
            'success': True,
            'message': f'Client {request.client_id} registered',
            'client_id': request.client_id
        }
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/client/train")
async def train_client(request: TrainingRequest):
    """Train client locally"""
    try:
        client = get_or_create_client(request.client_id)
        
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/client/participate")
async def participate_in_round(request: TrainingRequest):
    """Participate in current round with idempotency guard"""
    try:
        # Idempotency check: if client already participated in this round
        if (
            (request.client_id, server.round) in server.accepted_updates
            or request.client_id in server.client_weights
        ):
            return {
                'success': True,
                'duplicate': True,
                'message': f'Client {request.client_id} already participated in round {server.round}',
                'client_id': request.client_id,
                'round': server.round
            }

        client = get_or_create_client(request.client_id)
        
        # Get local data
        data, labels = client.simulate_driver_behavior()
        
        # Participate
        result = client.participate_in_round(
            data, labels,
            epochs=request.epochs
        )

        # Fallback drain to ensure server ingests the update immediately
        server.drain_pending_client_updates()

        return {
            'success': True,
            'data': result,
            'client_id': request.client_id
        }
    except Exception as e:
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")