import pytest
import torch

pytest.importorskip("torch_geometric")

from gnn.models import GNNFeatureScaler, GraphNetworkBuilder, RouteOptimizer


def _build_graph(lat, lng, traffic, speed_limit, edge_metrics):
    builder = GraphNetworkBuilder()
    nodes = [
        {
            "id": "A",
            "lat": lat,
            "lng": lng,
            "traffic": traffic,
            "road_type": "highway",
            "speed_limit": speed_limit,
        },
        {
            "id": "B",
            "lat": lat + 0.05,
            "lng": lng + 0.05,
            "traffic": traffic + 10,
            "road_type": "arterial",
            "speed_limit": speed_limit + 10,
        },
    ]
    distance, time, cost, fuel, congestion = edge_metrics
    edges = [
        {
            "source": "A",
            "target": "B",
            "distance": distance,
            "time": time,
            "cost": cost,
            "fuel": fuel,
            "congestion": congestion,
        }
    ]
    builder.build_road_network(nodes, edges)
    return builder.get_pytorch_data()


def test_extract_features_returns_raw_continuous_values():
    graph_data = _build_graph(
        12.97,
        77.59,
        20.0,
        80.0,
        (10.0, 15.0, 100.0, 5.0, 0.2),
    )

    assert graph_data.x[0].tolist() == pytest.approx(
        [12.97, 77.59, 20.0, 1.0, 0.0, 0.0, 0.0, 0.0, 80.0]
    )
    assert graph_data.edge_attr[0].tolist() == pytest.approx(
        [10.0, 15.0, 100.0, 5.0, 0.2]
    )


def test_scaler_standardizes_continuous_features_and_preserves_one_hot():
    first = _build_graph(
        12.0,
        77.0,
        20.0,
        60.0,
        (10.0, 15.0, 100.0, 5.0, 0.2),
    )
    second = _build_graph(
        28.0,
        77.5,
        80.0,
        100.0,
        (110.0, 45.0, 900.0, 50.0, 0.8),
    )

    scaler = GNNFeatureScaler().fit([first, second])
    transformed_first = scaler.transform_node_features(first.x)
    transformed_second = scaler.transform_node_features(second.x)

    continuous = torch.cat(
        [transformed_first[:, [0, 1, 2, 8]], transformed_second[:, [0, 1, 2, 8]]],
        dim=0,
    )
    assert torch.allclose(continuous.mean(dim=0), torch.zeros(4), atol=1e-6)
    assert torch.allclose(continuous.std(dim=0, unbiased=False), torch.ones(4), atol=1e-6)

    original_categorical = torch.cat([first.x[:, 3:8], second.x[:, 3:8]], dim=0)
    transformed_categorical = torch.cat(
        [transformed_first[:, 3:8], transformed_second[:, 3:8]], dim=0
    )
    torch.testing.assert_close(transformed_categorical, original_categorical)


def test_scaler_is_consistent_for_repeated_transforms():
    graph_data = _build_graph(
        12.0,
        77.0,
        20.0,
        60.0,
        (10.0, 15.0, 100.0, 5.0, 0.2),
    )
    scaler = GNNFeatureScaler().fit([graph_data])

    first = scaler.transform_node_features(graph_data.x)
    second = scaler.transform_node_features(graph_data.x)
    first_edges = scaler.transform_edge_features(graph_data.edge_attr)
    second_edges = scaler.transform_edge_features(graph_data.edge_attr)

    torch.testing.assert_close(first, second)
    torch.testing.assert_close(first_edges, second_edges)


def test_training_fits_scaler_without_mutating_raw_training_features():
    first = _build_graph(
        12.0,
        77.0,
        20.0,
        60.0,
        (10.0, 15.0, 100.0, 5.0, 0.2),
    )
    second = _build_graph(
        28.0,
        77.5,
        80.0,
        100.0,
        (110.0, 45.0, 900.0, 50.0, 0.8),
    )
    first_x = first.x.clone()
    first_edge_attr = first.edge_attr.clone()
    second_x = second.x.clone()
    second_edge_attr = second.edge_attr.clone()

    route_optimizer = RouteOptimizer(allow_untrained=True)
    route_optimizer.train([first, second], epochs=1)

    assert route_optimizer.feature_scaler.fitted is True
    torch.testing.assert_close(first.x, first_x)
    torch.testing.assert_close(first.edge_attr, first_edge_attr)
    torch.testing.assert_close(second.x, second_x)
    torch.testing.assert_close(second.edge_attr, second_edge_attr)


def test_saved_model_restores_exact_feature_scaler(tmp_path):
    training_data = [
        _build_graph(
            12.0,
            77.0,
            20.0,
            60.0,
            (10.0, 15.0, 100.0, 5.0, 0.2),
        ),
        _build_graph(
            28.0,
            77.5,
            80.0,
            100.0,
            (110.0, 45.0, 900.0, 50.0, 0.8),
        ),
    ]

    route_optimizer = RouteOptimizer(allow_untrained=True)
    route_optimizer.feature_scaler.fit(training_data)
    route_optimizer.model.eval()

    model_path = tmp_path / "gnn_route.pth"
    route_optimizer.save_model(str(model_path))

    loaded_optimizer = RouteOptimizer(allow_untrained=True)
    loaded_optimizer.load_model(str(model_path))
    loaded_optimizer.model.eval()

    graph_data = _build_graph(
        18.0,
        77.25,
        50.0,
        80.0,
        (60.0, 30.0, 500.0, 25.0, 0.5),
    )

    expected = route_optimizer.feature_scaler.transform_graph(graph_data.clone())
    actual = loaded_optimizer.feature_scaler.transform_graph(graph_data.clone())
    torch.testing.assert_close(actual.x, expected.x)
    torch.testing.assert_close(actual.edge_attr, expected.edge_attr)

    with torch.no_grad():
        expected_output = route_optimizer.model(
            expected.x,
            expected.edge_index,
            expected.edge_attr,
        )
        actual_output = loaded_optimizer.model(
            actual.x,
            actual.edge_index,
            actual.edge_attr,
        )
    torch.testing.assert_close(actual_output, expected_output)
