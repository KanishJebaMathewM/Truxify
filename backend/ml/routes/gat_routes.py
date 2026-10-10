import logging
import os
from datetime import datetime
from typing import Annotated, List

import networkx as nx
from fastapi import APIRouter, HTTPException
from gat.model import GATTrainer, SpatialTemporalGAT, TrafficGraphBuilder
from gat.serving_contract import GATGraphInputError, graph_policy
from gat.training_transition import (
    TrainingAdmissionError,
    admit_http_work,
    observed_targets,
)
from pydantic import BaseModel, ConfigDict, Field, StrictInt, model_validator

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/gat", tags=["Graph Attention Networks"])

# Initialize model. The node-feature dimension is derived from the builder
# (TrafficGraphBuilder.NODE_FEATURE_DIM == 5) so the model stays aligned with
# the 5 features get_pytorch_data() actually emits (#13979).
in_features = TrafficGraphBuilder.NODE_FEATURE_DIM
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

FiniteObservation = Annotated[float, Field(strict=True, allow_inf_nan=False)]


class Node(BaseModel):
    id: StrictInt
    lat: FiniteObservation
    lng: FiniteObservation
    traffic: FiniteObservation = 0
    speed: FiniteObservation = 50
    road_type: str = Field(default="local", strict=True, min_length=1, max_length=64)

class Edge(BaseModel):
    source: StrictInt
    target: StrictInt
    distance: FiniteObservation
    travel_time: FiniteObservation = 0
    congestion: FiniteObservation = 0

class GraphRequest(BaseModel):
    nodes: List[Node] = Field(max_length=4096)
    edges: List[Edge] = Field(max_length=100000)

    @model_validator(mode="after")
    def validate_topology(self):
        node_ids = [node.id for node in self.nodes]
        known = set(node_ids)
        if len(known) != len(node_ids):
            raise ValueError("Traffic graph node IDs must be unique")
        if any(edge.source not in known or edge.target not in known for edge in self.edges):
            raise ValueError("Traffic graph edges must reference declared nodes")
        return self

class ObservedNodeTarget(BaseModel):
    node_id: Annotated[int, Field(strict=True)]
    values: List[Annotated[float, Field(strict=True, allow_inf_nan=False)]]


class TrainingRequest(GraphRequest):
    model_config = ConfigDict(extra="forbid")
    targets: Annotated[List[ObservedNodeTarget], Field(min_length=1, max_length=4096)]
    epochs: Annotated[int, Field(strict=True, ge=1, le=16)] = 1


@router.post("/build-graph")
async def build_graph(request: GraphRequest):
    """Build traffic graph"""
    try:
        request_builder = TrafficGraphBuilder()
        graph = request_builder.build_graph(
            [node.model_dump() for node in request.nodes],
            [edge.model_dump() for edge in request.edges]
        )
        data = request_builder.get_pytorch_data(graph)

        return {
            'success': True,
            'data': {
                'nodes': len(graph.nodes),
                'edges': len(graph.edges),
                'features': list(data.x.shape),
                'is_connected': nx.is_connected(graph) if graph.number_of_nodes() else False
            },
            'timestamp': datetime.now().isoformat()
        }
    except Exception as e:
        logger.error(f"Graph build failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/predict")
def predict_traffic(request: GraphRequest):
    """Predict traffic using GAT"""
    try:
        with trainer._state_lock:
            generation = trainer.model
            # Match the undirected builder's deduplication before native export.
            native_edges = 2 * len({
                (min(edge.source, edge.target), max(edge.source, edge.target))
                for edge in request.edges
            })
            graph_policy(generation, 1, len(request.nodes), 1, native_edges)
            request_builder = TrafficGraphBuilder()
            graph = request_builder.build_graph(
                [node.model_dump() for node in request.nodes],
                [edge.model_dump() for edge in request.edges])
            data = request_builder.get_pytorch_data(graph)
            result = trainer.predict(data)
            return {'success': True,
                    'data': {**{name: value.tolist() for name, value in result.items()},
                             'horizon': generation.prediction_horizon},
                    'timestamp': datetime.now().isoformat()}
    except GATGraphInputError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as e:
        logger.error(f"Prediction failed: {e}")
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/train")
def train_model(request: TrainingRequest):
    """Train from explicit observed horizons aligned to public node identity."""
    try:
        with trainer._state_lock:
            if not request.nodes or len(request.nodes) > 4096 or len(request.edges) > 65536:
                raise TrainingAdmissionError('training graph exceeds supported node/edge bounds')
            admit_http_work(trainer.model, len(request.nodes), request.epochs)
            request_builder = TrafficGraphBuilder()
            graph = request_builder.build_graph(
                [node.model_dump() for node in request.nodes],
                [edge.model_dump() for edge in request.edges],
            )
            data = request_builder.get_pytorch_data(graph)
            parameter = next(trainer.model.parameters())
            data.x = data.x.to(dtype=parameter.dtype)
            targets = observed_targets(request.targets, list(graph.nodes), trainer.model.prediction_horizon,
                                       dtype=parameter.dtype, device=trainer.device)
            results = trainer.train(data, targets, epochs=request.epochs)
            results['target_source'] = 'provided_observations'
            results['node_ids'] = list(graph.nodes)
            results['horizon'] = trainer.model.prediction_horizon
            return {'success': True, 'data': results, 'timestamp': datetime.now().isoformat()}
    except TrainingAdmissionError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except Exception as exc:
        logger.error(f'GAT observed training failed: {exc}')
        raise HTTPException(status_code=500, detail='Internal server error') from exc

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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/save")
def save_model(path: str = "models/gat_traffic.pth"):
    path = os.path.join("models", os.path.basename(path))
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")

@router.post("/load")
def load_model(path: str = "models/gat_traffic.pth"):
    path = os.path.join("models", os.path.basename(path))
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
        logger.error(f"Internal error: {e}")

        raise HTTPException(status_code=500, detail="Internal server error")