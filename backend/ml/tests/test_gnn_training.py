import asyncio

import pytest
import torch

pytest.importorskip("fastapi")
torch_geometric = pytest.importorskip("torch_geometric")

from torch_geometric.data import Data

from gnn.models import GraphNetworkBuilder, RouteOptimizer
from routes import gnn_routes


def _synthetic_sample():
    """One minimal training sample built from a real two-node graph."""
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {'id': 'A', 'lat': 12.97, 'lng': 77.59},
            {'id': 'B', 'lat': 12.98, 'lng': 77.60},
        ],
        [
            {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 15.0,
             'cost': 100.0, 'fuel': 5.0, 'congestion': 0.2},
        ],
    )
    graph_data = builder.get_pytorch_data()
    return Data(
        x=graph_data.x.clone(),
        edge_index=graph_data.edge_index.clone(),
        edge_attr=graph_data.edge_attr.clone(),
        y=torch.tensor([15.0], dtype=torch.float),
    )


def test_train_endpoint_forwards_requested_learning_rate(monkeypatch):
    captured = {}

    def fake_train(train_data, val_data=None, epochs=100, learning_rate=0.001):
        captured["epochs"] = epochs
        captured["learning_rate"] = learning_rate
        return 0.25

    monkeypatch.setattr(gnn_routes.optimizer, "train", fake_train)

    request = gnn_routes.TrainRequest(epochs=12, learning_rate=0.025)
    response = asyncio.run(gnn_routes.train_model(request))

    assert response["success"] is True
    assert response["data"]["epochs"] == 12
    assert captured == {"epochs": 12, "learning_rate": 0.025}


def test_route_optimizer_train_uses_requested_learning_rate(monkeypatch):
    captured = {}
    real_adam = torch.optim.Adam

    def capturing_adam(parameters, **kwargs):
        captured.update(kwargs)
        return real_adam(parameters, **kwargs)

    monkeypatch.setattr(torch.optim, "Adam", capturing_adam)

    optimizer = RouteOptimizer()
    optimizer.train([_synthetic_sample()], epochs=1, learning_rate=0.025)

    assert captured["lr"] == pytest.approx(0.025)


def test_route_optimizer_train_preserves_default_learning_rate(monkeypatch):
    captured = {}
    real_adam = torch.optim.Adam

    def capturing_adam(parameters, **kwargs):
        captured.update(kwargs)
        return real_adam(parameters, **kwargs)

    monkeypatch.setattr(torch.optim, "Adam", capturing_adam)

    optimizer = RouteOptimizer()
    optimizer.train([_synthetic_sample()], epochs=1)

    assert captured["lr"] == pytest.approx(0.001)
