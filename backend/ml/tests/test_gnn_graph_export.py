"""Native NetworkX/PyG graph selection and raw scaler input interoperability."""
from concurrent.futures import ThreadPoolExecutor

import networkx as nx
import pytest
import torch
from gnn.models import GNNFeatureScaler, GNNRouteModel, GraphNetworkBuilder


def graph(prefix='a', multi=True, count=2):
    result = nx.MultiDiGraph() if multi else nx.DiGraph()
    result.add_node(prefix, lat=12, lng=77, traffic=20, road_type='highway', speed_limit=80)
    result.add_node(prefix + 'b', lat=13, lng=78, traffic=40, road_type='local', speed_limit=100)
    for i in range(count):
        result.add_edge(prefix, prefix + 'b', distance=100 + i, time=20 + i,
                        cost=1000 + i, fuel=30 + i, congestion=0.2 + i / 10)
    return result


@pytest.mark.parametrize('multi', [True, False])
def test_explicit_graph_owns_node_map_and_raw_export(multi):
    builder = GraphNetworkBuilder()
    builder.graph = graph('foreign')
    requested = graph('own', multi=multi)
    data = builder.get_pytorch_data(requested)
    assert data.graph is requested
    assert data.node_map == {'own': 0, 'ownb': 1}
    assert list(builder.graph.nodes) == ['foreign', 'foreignb']
    torch.testing.assert_close(data.x[0], torch.tensor([12., 77., 20., 1., 0., 0., 0., 0., 80.]))
    expected_count = 2 if multi else 1
    assert data.edge_attr.shape == (expected_count, 5)
    assert data.edge_index.tolist() == [[0] * expected_count, [1] * expected_count]
    assert data.edge_attr[:, 1].tolist() == pytest.approx([20, 21] if multi else [21])


@pytest.mark.parametrize('count', [1, 2, 7])
def test_each_keyed_segment_has_matching_native_pyg_row(count):
    requested = graph(count=count)
    requested.add_edge('ab', 'a', key='reverse', distance=999, time=99)
    data = GraphNetworkBuilder().get_pytorch_data(requested)
    expected = list(requested.edges(data=True, keys=True))
    assert data.edge_index.shape == (2, count + 1)
    for row, (source, target, key, attrs) in enumerate(expected):
        assert data.edge_index[:, row].tolist() == [data.node_map[source], data.node_map[target]]
        assert data.edge_attr[row, :2].tolist() == pytest.approx([attrs['distance'], attrs['time']])


@pytest.mark.parametrize('count', [0, 1, 3])
def test_empty_or_isolated_graph_has_stable_tensor_shapes(count):
    requested = nx.MultiDiGraph()
    for i in range(count):
        requested.add_node(str(i), lat=0, lng=0)
    data = GraphNetworkBuilder().get_pytorch_data(requested)
    assert data.x.shape == (count, 9)
    assert data.edge_index.shape == (2, 0)
    assert data.edge_attr.shape == (0, 5)
    assert data.node_map == {str(i): i for i in range(count)}


def test_no_argument_compatibility_and_explicit_graph_match():
    builder = GraphNetworkBuilder()
    builder.graph = graph()
    explicit = builder.get_pytorch_data(builder.graph)
    implicit = builder.get_pytorch_data()
    torch.testing.assert_close(explicit.x, implicit.x)
    torch.testing.assert_close(explicit.edge_attr, implicit.edge_attr)
    assert explicit.node_map == implicit.node_map


def test_native_scaler_receives_raw_units_exactly_once():
    data = GraphNetworkBuilder().get_pytorch_data(graph())
    before = data.x.clone(), data.edge_attr.clone()
    transformed = GNNFeatureScaler.default().transform_graph(data.clone())
    assert transformed.x[0, [2, 8]].tolist() == pytest.approx([-0.6, 0.6])
    assert transformed.edge_attr[0].tolist() == pytest.approx([0, -0.8, 0, -0.7, -0.6])
    torch.testing.assert_close(transformed.x[:, 3:8], before[0][:, 3:8])
    torch.testing.assert_close(data.x, before[0])
    torch.testing.assert_close(data.edge_attr, before[1])


def test_fitted_scaler_and_actual_torch_model_consume_native_parallel_export():
    data = GraphNetworkBuilder().get_pytorch_data(graph())
    scaler = GNNFeatureScaler().fit([data])
    assert scaler.node_mean.tolist() == pytest.approx([12.5, 77.5, 30, 90])
    assert scaler.edge_mean.tolist() == pytest.approx([100.5, 20.5, 1000.5, 30.5, 0.25])
    transformed = scaler.transform_graph(data.clone())
    model = GNNRouteModel().eval()
    with torch.no_grad():
        result = model(transformed.x, transformed.edge_index, transformed.edge_attr)
    assert result.shape[0] == 2
    assert torch.isfinite(result).all()


def test_concurrent_explicit_exports_never_read_another_graph():
    builder = GraphNetworkBuilder()
    builder.graph = graph('foreign')
    requested = [graph(f'g{i}') for i in range(12)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(builder.get_pytorch_data, requested))
    for index, data in enumerate(results):
        assert data.graph is requested[index]
        assert data.node_map == {f'g{index}': 0, f'g{index}b': 1}
        assert data.edge_index.tolist() == [[0, 0], [1, 1]]
    assert list(builder.graph.nodes) == ['foreign', 'foreignb']


def test_direct_compatibility_extractor_returns_raw_training_units():
    builder = GraphNetworkBuilder()
    builder.graph = graph()
    features = builder.extract_features()
    assert features['node_features'][0, [2, 8]].tolist() == pytest.approx([20, 80])
    assert features['edge_features'][0].tolist() == pytest.approx([100, 20, 1000, 30, 0.2])
    assert features['node_map'] == {'a': 0, 'ab': 1}
