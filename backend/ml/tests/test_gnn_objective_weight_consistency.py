import pytest

pytest.importorskip("torch_geometric")

from gnn import models as gnn_models
from gnn.models import RouteOptimizer
from routes import gnn_routes


def _frontier():
    return [
        {
            "route": [{"from": "a", "to": "b"}],
            "total_time": 10.0,
            "total_cost": 20.0,
            "total_fuel": 8.0,
            "total_distance": 100.0,
            "total_congestion": 1.0,
        },
        {
            "route": [{"from": "a", "to": "c"}],
            "total_time": 12.0,
            "total_cost": 10.0,
            "total_fuel": 4.0,
            "total_distance": 100.0,
            "total_congestion": 1.0,
        },
    ]


def test_api_and_optimizer_use_the_same_representative_route_weights(monkeypatch):
    assert gnn_routes.DEFAULT_MULTI_OBJECTIVE_WEIGHTS is gnn_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS

    frontier = _frontier()
    monkeypatch.setattr(gnn_routes.optimizer, "_find_pareto_routes", lambda *args, **kwargs: frontier)

    api_result = gnn_routes._multi_objective_optimization("a", "b", object())

    optimizer = object.__new__(RouteOptimizer)
    monkeypatch.setattr(optimizer, "_find_pareto_routes", lambda *args, **kwargs: frontier)
    optimizer_result = optimizer.multi_objective_optimization("a", "b", object())

    assert api_result["route"] == optimizer_result["route"]


def test_extended_objectives_use_centralized_weights(monkeypatch):
    frontier = [
        {
            "route": [{"from": "a", "to": "b"}],
            "total_time": 10.0,
            "total_cost": 100.0,
            "total_fuel": 100.0,
            "total_distance": 100.0,
            "total_congestion": 1.0,
        },
        {
            "route": [{"from": "a", "to": "c"}],
            "total_time": 30.0,
            "total_cost": 0.0,
            "total_fuel": 0.0,
            "total_distance": 0.0,
            "total_congestion": 1.0,
        },
    ]
    monkeypatch.setattr(gnn_routes.optimizer, "_find_pareto_routes", lambda *args, **kwargs: frontier)

    result = gnn_routes._multi_objective_optimization(
        "a", "b", object(), objectives=["time", "distance"]
    )

    first_score = (
        gnn_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS["time"] * 10.0
        + gnn_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS["distance"] * 100.0
    )
    second_score = (
        gnn_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS["time"] * 30.0
        + gnn_models.DEFAULT_MULTI_OBJECTIVE_WEIGHTS["distance"] * 0.0
    )

    assert first_score > second_score
    assert result["route"] == frontier[1]["route"]
