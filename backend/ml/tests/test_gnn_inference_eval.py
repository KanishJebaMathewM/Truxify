import numpy as np
import pytest

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


def test_route_inference_uses_eval_mode_without_mutating_batchnorm_state():
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.97, "lng": 77.59},
            {"id": "B", "lat": 12.98, "lng": 77.60},
        ],
        [
            {"source": "A", "target": "B", "distance": 10.0, "time": 10.0},
        ],
    )
    graph_data = builder.get_pytorch_data()

    optimizer = RouteOptimizer()
    optimizer.model.train()
    captured_embeddings = []

    def capture_embeddings(start, end, embeddings, graph_data, objectives, constraints):
        captured_embeddings.append(np.array(embeddings, copy=True))
        return [{
            "from": "A",
            "to": "B",
            "distance": 10.0,
            "time": 10.0,
            "cost": 0,
            "fuel": 0,
            "congestion": 0,
        }]

    optimizer._find_optimal_route = capture_embeddings
    running_mean = optimizer.model.bn1.running_mean.detach().clone()
    running_var = optimizer.model.bn1.running_var.detach().clone()

    first = optimizer.optimize_route("A", "B", graph_data, objectives=["time"])
    second = optimizer.optimize_route("A", "B", graph_data, objectives=["time"])

    assert first["success"] is True
    assert second["success"] is True
    assert len(captured_embeddings) == 2
    assert np.array_equal(captured_embeddings[0], captured_embeddings[1])
    assert optimizer.model.training is True
    assert optimizer.model.bn1.running_mean.equal(running_mean)
    assert optimizer.model.bn1.running_var.equal(running_var)
