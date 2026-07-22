from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
import networkx as nx
import json
from datetime import datetime
import logging

from gnn.models import GraphNetworkBuilder, RouteOptimizer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gnn", tags=["Graph Neural Networks"])

# Initialize GNN components
builder = GraphNetworkBuilder()
optimizer = RouteOptimizer()

class Node(BaseModel):
    id: str
    lat: float
    lng: float
    traffic: Optional[float] = 0
    road_type: Optional[str] = "local"
    speed_limit: Optional[float] = 50

class Edge(BaseModel):
    source: str
    target: str
    distance: float
    time: float
    cost: Optional[float] = 0
    fuel: Optional[float] = 0
    congestion: Optional[float] = 0

class RouteRequest(BaseModel):
    start_node: str
    end_node: str
    nodes: List[Node]
    edges: List[Edge]
    objectives: Optional[List[str]] = ["time", "cost", "fuel"]

class TrainRequest(BaseModel):
    epochs: int = 100
    learning_rate: float = 0.001

@router.post("/build-graph")
async def build_graph(nodes: List[Node], edges: List[Edge]):
    """Build road network graph"""
    try:
        graph = builder.build_road_network(
            [node.dict() for node in nodes],
            [edge.dict() for edge in edges]
        )
        
        return {
            'success': True,
            'data': {
                'nodes': len(graph.nodes),
                'edges': len(graph.edges),
                'is_connected': nx.is_connected(graph)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Graph building failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/optimize-route")
async def optimize_route(request: RouteRequest):
    """Optimize route using GNN"""
    try:
        # Build graph
        graph = builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        
        # Get PyTorch data
        graph_data = builder.get_pytorch_data()
        
        # Optimize route
        result = optimizer.optimize_route(
            request.start_node,
            request.end_node,
            graph_data,
            request.objectives
        )
        
        if result:
            return {
                'success': True,
                'data': result,
                'timestamp': datetime.now().isoformat()
            }
        else:
            return {
                'success': False,
                'error': 'Route optimization failed',
                'timestamp': datetime.now().isoformat()
            }
    except Exception as e:
        logger.error(f"Route optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/multi-objective")
async def multi_objective_optimize(request: RouteRequest):
    """Multi-objective route optimization"""
    try:
        # Build graph
        graph = builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        
        graph_data = builder.get_pytorch_data()
        
        result = optimizer.multi_objective_optimization(
            request.start_node,
            request.end_node,
            graph_data
        )
        
        return {
            'success': True,
            'data': result,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Multi-objective optimization failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def train_model(request: TrainRequest):
    """Train GNN model"""
    try:
        # In production: load training data
        train_data = []
        val_data = []
        
        loss = optimizer.train(train_data, val_data, request.epochs)
        
        return {
            'success': True,
            'data': {
                'loss': loss,
                'epochs': request.epochs
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/update-route")
async def update_route(route: List[Dict], traffic_data: Dict):
    """Update route with real-time traffic"""
    try:
        updated_route = optimizer.real_time_update(route, traffic_data)
        
        return {
            'success': True,
            'data': updated_route,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Route update failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model/status")
async def get_model_status():
    """Get GNN model status"""
    try:
        return {
            'success': True,
            'data': {
                'model_loaded': optimizer.model is not None,
                'device': str(optimizer.device),
                'parameters': sum(p.numel() for p in optimizer.model.parameters()) if optimizer.model else 0
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model status failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/model/save")
async def save_model(path: str = "models/gnn_route.pth"):
    """Save GNN model"""
    try:
        optimizer.save_model(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/model/load")
async def load_model(path: str = "models/gnn_route.pth"):
    """Load GNN model"""
    try:
        optimizer.load_model(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))