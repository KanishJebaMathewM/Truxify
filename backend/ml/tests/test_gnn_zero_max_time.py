import pytest
import torch

torch_geometric = pytest.importorskip("torch_geometric")
from gnn.models import GraphNetworkBuilder, RouteOptimizer


@pytest.fixture
def sample_network():
    builder = GraphNetworkBuilder()
    nodes = [
        {'id': 'A', 'lat': 12.97, 'lng': 77.59, 'traffic': 20, 'road_type': 'highway', 'speed_limit': 80},
        {'id': 'B', 'lat': 12.98, 'lng': 77.60, 'traffic': 30, 'road_type': 'arterial', 'speed_limit': 60},
        {'id': 'C', 'lat': 12.99, 'lng': 77.61, 'traffic': 10, 'road_type': 'highway', 'speed_limit': 80},
    ]
    edges = [
        {'source': 'A', 'target': 'B', 'distance': 10.0, 'time': 15.0, 'cost': 100.0, 'fuel': 5.0, 'congestion': 0.2},
        {'source': 'B', 'target': 'C', 'distance': 15.0, 'time': 20.0, 'cost': 150.0, 'fuel': 7.0, 'congestion': 0.1},
        {'source': 'A', 'target': 'C', 'distance': 22.0, 'time': 25.0, 'cost': 300.0, 'fuel': 10.0, 'congestion': 0.5},
    ]
    builder.build_road_network(nodes, edges)
    return builder.get_pytorch_data()


def test_zero_max_time_is_enforced(sample_network):
    optimizer = RouteOptimizer()

    result = optimizer.optimize_route(
        'A',
        'C',
        sample_network,
        constraints={'max_time': 0},
    )

    assert result is None


def test_zero_hos_limit_is_enforced(sample_network):
    optimizer = RouteOptimizer()

    result = optimizer.optimize_route(
        'A',
        'C',
        sample_network,
        constraints={'hos_limit': 0},
    )

    assert result is None
