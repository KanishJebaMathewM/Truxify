import pytest

pytest.importorskip("torch_geometric")

from gnn.models import GraphNetworkBuilder, RouteOptimizer


def _graph_data(time_scale=1.0, distance_scale=1.0):
    builder = GraphNetworkBuilder()
    builder.build_road_network(
        [
            {"id": "A", "lat": 12.0, "lng": 77.0},
            {"id": "B", "lat": 13.0, "lng": 78.0},
            {"id": "C", "lat": 14.0, "lng": 79.0},
        ],
        [
            {
                "source": "A",
                "target": "B",
                "time": 10.0 * time_scale,
                "distance": 100.0 * distance_scale,
            },
            {
                "source": "A",
                "target": "C",
                "time": 12.0 * time_scale,
                "distance": 80.0 * distance_scale,
            },
        ],
    )
    return builder.get_pytorch_data()


def test_objective_scores_are_invariant_to_equivalent_unit_changes():
    optimizer = RouteOptimizer(allow_untrained=True)
    objectives = ["time", "distance"]

    minutes_km = _graph_data()
    seconds_meters = _graph_data(time_scale=60.0, distance_scale=1000.0)

    score_ab = optimizer._calculate_score(
        None, "A", "B", objectives, minutes_km, minutes_km.node_map
    )
    score_ac = optimizer._calculate_score(
        None, "A", "C", objectives, minutes_km, minutes_km.node_map
    )
    scaled_score_ab = optimizer._calculate_score(
        None, "A", "B", objectives, seconds_meters, seconds_meters.node_map
    )
    scaled_score_ac = optimizer._calculate_score(
        None, "A", "C", objectives, seconds_meters, seconds_meters.node_map
    )

    assert score_ab == pytest.approx(scaled_score_ab)
    assert score_ac == pytest.approx(scaled_score_ac)
    assert (score_ab < score_ac) == (scaled_score_ab < scaled_score_ac)
