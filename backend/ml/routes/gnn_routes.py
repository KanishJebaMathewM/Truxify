from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, confloat
from typing import List, Dict, Any, Optional
import networkx as nx
import json
from datetime import datetime
import logging

from gnn.models import GraphNetworkBuilder, RouteOptimizer
import os

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gnn", tags=["Graph Neural Networks"])

# Initialize GNN components
builder = GraphNetworkBuilder()
optimizer = RouteOptimizer()

SUPPORTED_ROUTE_OBJECTIVES = frozenset({
    "time",
    "cost",
    "fuel",
    "distance",
    "congestion",
})


def validate_route_objectives(objectives):
    """Validate that every requested route objective is supported."""
    if objectives is None:
        return

    invalid_objectives = []
    for objective in objectives:
        if not isinstance(objective, str) or objective not in SUPPORTED_ROUTE_OBJECTIVES:
            if objective not in invalid_objectives:
                invalid_objectives.append(objective)

    if invalid_objectives:
        invalid = ", ".join(repr(objective) for objective in invalid_objectives)
        supported = ", ".join(sorted(SUPPORTED_ROUTE_OBJECTIVES))
        raise HTTPException(
            status_code=422,
            detail=(
                f"Unsupported route objective(s): {invalid}. "
                f"Supported objectives: {supported}."
            ),
        )

class Node(BaseModel):
    id: str
    lat: confloat(allow_inf_nan=False, ge=-90, le=90)
    lng: confloat(allow_inf_nan=False, ge=-180, le=180)
    traffic: Optional[confloat(allow_inf_nan=False, ge=0, le=100)] = 0
    road_type: Optional[str] = "local"
    speed_limit: Optional[confloat(allow_inf_nan=False, ge=0)] = 50

class Edge(BaseModel):
    source: str
    target: str
    distance: float
    time: float
    cost: Optional[float] = 0
    fuel: Optional[float] = 0
    congestion: Optional[float] = 0
    hazmat_allowed: Optional[bool] = True
    max_weight: Optional[float] = None
    max_height: Optional[float] = None

class RouteRequest(BaseModel):
    start_node: str
    end_node: str
    nodes: List[Node]
    edges: List[Edge]
    objectives: Optional[List[str]] = ["time", "cost", "fuel"]
    constraints: Optional[Dict[str, Any]] = None

class RouteUpdateRequest(BaseModel):
    route: List[Dict[str, Any]]
    nodes: List[Node]
    edges: List[Edge]
    traffic_data: Dict[str, Dict[str, Any]]
    objectives: Optional[List[str]] = ["time", "cost", "fuel"]
    constraints: Optional[Dict[str, Any]] = None

class TrainRequest(BaseModel):
    epochs: int = 100
    learning_rate: float = 0.001


def _multi_objective_optimization(start, end, graph_data, objectives=None, constraints=None):
    """Select a representative route from the optimizer's Pareto frontier."""
    requested_objectives = list(objectives) if objectives else ["time", "cost", "fuel"]
    allowed_objectives = {"time", "cost", "fuel", "distance", "congestion"}
    invalid_objectives = [objective for objective in requested_objectives if objective not in allowed_objectives]
    if invalid_objectives:
        raise ValueError(f"Unsupported objectives: {', '.join(invalid_objectives)}")

    frontier = optimizer._find_pareto_routes(
        start,
        end,
        graph_data,
        requested_objectives,
        constraints,
    )
    if not frontier:
        return None

    weights = {
        "time": 0.5,
        "cost": 0.3,
        "fuel": 0.2,
        "distance": 0.2,
        "congestion": 2.0,
    }
    best_route = min(
        frontier,
        key=lambda candidate: sum(
            weights.get(objective, 1.0) * candidate.get(f"total_{objective}", 0)
            for objective in requested_objectives
        ),
    )

    result = dict(best_route)
    result["pareto_routes"] = frontier
    result["pareto_count"] = len(frontier)
    return result

@router.post("/build-graph")
async def build_graph(nodes: List[Node], edges: List[Edge]):
    """Build road network graph"""
    if not nodes:
        raise HTTPException(
            status_code=422,
            detail="At least one node is required to build a graph"
        )

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
                'is_connected': nx.is_weakly_connected(graph)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Graph building failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/optimize-route")
async def optimize_route(request: RouteRequest):
    """Optimize route using GNN"""
    validate_route_objectives(request.objectives)
    try:
        graph = builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        
        graph_data = builder.get_pytorch_data()
        
        result = optimizer.optimize_route(
            request.start_node,
            request.end_node,
            graph_data,
            request.objectives,
            request.constraints
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/multi-objective")
async def multi_objective_optimize(request: RouteRequest):
    """Multi-objective route optimization"""
    validate_route_objectives(request.objectives)
    try:
        graph = builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        
        graph_data = builder.get_pytorch_data()
        
        result = _multi_objective_optimization(
            request.start_node,
            request.end_node,
            graph_data,
            objectives=request.objectives,
            constraints=request.constraints
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
                'error': 'Multi-objective route optimization failed',
                'timestamp': datetime.now().isoformat()
            }
    except Exception as e:
        logger.error(f"Multi-objective optimization failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/train")
async def train_model(request: TrainRequest):
    """Train GNN model"""
    try:
        train_data = []
        val_data = []
        
        loss = optimizer.train(
            train_data,
            val_data,
            request.epochs,
            request.learning_rate
        )
        
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/update-route")
async def update_route(request: RouteUpdateRequest):
    """Update route with real-time traffic and reroute over the updated network."""
    try:
        request_builder = GraphNetworkBuilder()
        request_builder.build_road_network(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        graph_data = request_builder.get_pytorch_data()

        start = request.route[0].get('from') if request.route else None
        end = request.route[-1].get('to') if request.route else None
        if start is None or end is None:
            raise HTTPException(
                status_code=422,
                detail="Route must contain at least one edge with 'from' and 'to' fields"
            )

        updated_route = optimizer.real_time_update(
            request.route,
            request.traffic_data,
            graph_data=graph_data,
            objectives=request.objectives,
            constraints=request.constraints
        )

        return {
            'success': True,
            'data': updated_route,
            'timestamp': datetime.now().isoformat()
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Route update failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/model/save")
async def save_model(path: str = "models/gnn_route.pth"):
    path = os.path.join("models", os.path.basename(path))
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/model/load")
async def load_model(path: str = "models/gnn_route.pth"):
    path = os.path.join("models", os.path.basename(path))
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")
