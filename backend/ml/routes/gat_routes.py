from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import torch
import numpy as np
from datetime import datetime
import logging
from gat.model import SpatialTemporalGAT, TrafficGraphBuilder, GATTrainer

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gat", tags=["Graph Attention Networks"])

# Initialize model
in_features = 64
hidden_features = 128
out_features = 32
num_heads = 8
time_steps = 12
prediction_horizon = 6

model = SpatialTemporalGAT(
    in_features=in_features,
    hidden_features=hidden_features,
    out_features=out_features,
    num_heads=num_heads,
    time_steps=time_steps,
    prediction_horizon=prediction_horizon
)
trainer = GATTrainer(model)
builder = TrafficGraphBuilder()

class Node(BaseModel):
    id: int
    lat: float
    lng: float
    traffic: Optional[float] = 0
    speed: Optional[float] = 50
    road_type: Optional[str] = "local"

class Edge(BaseModel):
    source: int
    target: int
    distance: float
    travel_time: Optional[float] = 0
    congestion: Optional[float] = 0

class GraphRequest(BaseModel):
    nodes: List[Node]
    edges: List[Edge]

@router.post("/build-graph")
async def build_graph(request: GraphRequest):
    """Build traffic graph"""
    try:
        graph = builder.build_graph(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        data = builder.get_pytorch_data()
        
        return {
            'success': True,
            'data': {
                'nodes': len(graph.nodes),
                'edges': len(graph.edges),
                'features': data.x.shape,
                'is_connected': nx.is_connected(graph)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Graph build failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/predict")
async def predict_traffic(request: GraphRequest):
    """Predict traffic using GAT"""
    try:
        # Build graph
        graph = builder.build_graph(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        data = builder.get_pytorch_data()
        
        # Generate synthetic node features for time steps
        node_features = data.x.unsqueeze(0).unsqueeze(0)  # (1, 1, nodes, features)
        
        # Predict
        predictions = trainer.model.predict_traffic(node_features, data.edge_index)
        
        return {
            'success': True,
            'data': {
                'predictions': predictions['predictions'].cpu().numpy().tolist(),
                'mean': predictions['mean'].cpu().numpy().tolist(),
                'std': predictions['std'].cpu().numpy().tolist(),
                'horizon': trainer.model.prediction_horizon
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/train")
async def train_model(request: GraphRequest):
    """Train GAT model"""
    try:
        # Build graph
        graph = builder.build_graph(
            [node.dict() for node in request.nodes],
            [edge.dict() for edge in request.edges]
        )
        data = builder.get_pytorch_data()
        
        # Generate synthetic targets
        targets = torch.randn(data.x.shape[0], trainer.model.prediction_horizon)
        
        # Train
        results = trainer.train(data, targets, epochs=50)
        
        return {
            'success': True,
            'data': results,
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Training failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/model-info")
async def get_model_info():
    """Get model information"""
    try:
        return {
            'success': True,
            'data': {
                'in_features': in_features,
                'hidden_features': hidden_features,
                'out_features': out_features,
                'num_heads': num_heads,
                'time_steps': time_steps,
                'prediction_horizon': prediction_horizon,
                'parameters': sum(p.numel() for p in model.parameters()),
                'trainable': sum(p.numel() for p in model.parameters() if p.requires_grad),
                'device': str(trainer.device)
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Model info failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/save")
async def save_model(path: str = "models/gat_traffic.pth"):
    """Save GAT model"""
    try:
        trainer.save(path)
        return {
            'success': True,
            'message': f'Model saved to {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Save failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/load")
async def load_model(path: str = "models/gat_traffic.pth"):
    """Load GAT model"""
    try:
        trainer.load(path)
        return {
            'success': True,
            'message': f'Model loaded from {path}',
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Load failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))