import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("metric", ["distance", "time", "cost", "fuel", "congestion"])
def test_build_road_network_rejects_non_finite_edge_metrics(metric, value):
    builder = GraphNetworkBuilder()
    nodes = [
        {"id": "A", "lat": 12.97, "lng": 77.59},
        {"id": "B", "lat": 12.98, "lng": 77.60},
    ]
    edge = {
        "source": "A",
        "target": "B",
        "distance": 10.0,
        "time": 10.0,
        "cost": 20.0,
        "fuel": 5.0,
        "congestion": 0.2,
    }
    edge[metric] = value

    with pytest.raises(ValueError, match="Non-finite edge metric"):
        builder.build_road_network(nodes, [edge])

    assert len(builder.graph.nodes) == 0
    assert len(builder.graph.edges) == 0


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
@pytest.mark.parametrize("metric", ["time", "cost", "fuel", "congestion"])
def test_real_time_update_rejects_non_finite_traffic_metrics(metric, value):
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
    current_route = [{
        "from": "A",
        "to": "B",
        "distance": 10.0,
        "time": 10.0,
        "cost": 0,
        "fuel": 0,
        "congestion": 0,
    }]

    with pytest.raises(ValueError, match="Non-finite traffic metric"):
        optimizer.real_time_update(
            current_route,
            {"A-B": {metric: value}},
            graph_data=graph_data,
        )

    assert builder.graph["A"]["B"][metric] == {
        "time": 10.0,
        "cost": 0,
        "fuel": 0,
        "congestion": 0,
    }[metric]
