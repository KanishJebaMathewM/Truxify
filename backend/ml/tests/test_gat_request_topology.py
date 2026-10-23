"""Native request graphs, identity mapping, publication and mounted ASGI."""
from concurrent.futures import ThreadPoolExecutor

import httpx
import networkx as nx
import pytest
import torch
from fastapi import FastAPI
from gat.model import GraphAttentionLayer, TrafficGraphBuilder
from routes import gat_routes as r


def nodes(ids=(100, 500)):
    return [{'id': node, 'lat': i, 'lng': i, 'traffic': 20 + i, 'speed': 80}
            for i, node in enumerate(ids)]


def edges(ids=(100, 500)):
    return [{'source': ids[0], 'target': ids[1], 'distance': 1}]


@pytest.mark.parametrize('ids', [(100, 500), (-7, 30), (9, 2)])
def test_public_ids_map_to_native_pyg_rows(ids):
    builder = TrafficGraphBuilder()
    graph = builder.build_graph(nodes(ids), edges(ids))
    data = builder.get_pytorch_data(graph)
    assert data.node_map == {ids[0]: 0, ids[1]: 1}
    assert data.edge_index.tolist() == [[0, 1], [1, 0]]
    assert data.graph is graph
    layer = GraphAttentionLayer(5, 8, num_heads=2).eval()
    output = layer(data.x, data.edge_index)
    assert output.shape == (2, 8)
    assert torch.isfinite(output).all()


def test_rebuild_does_not_accumulate_or_mutate_prior_snapshot():
    builder = TrafficGraphBuilder()
    first = builder.build_graph(nodes(), edges())
    second = builder.build_graph(nodes((7, 9)), edges((7, 9)))
    assert list(first.nodes) == [100, 500]
    assert list(second.nodes) == [7, 9]
    assert first is not second
    exported = builder.get_pytorch_data(first)
    assert exported.node_map == {100: 0, 500: 1}
    assert exported.x.shape == (2, 5)
    assert builder.get_pytorch_data().node_map == {7: 0, 9: 1}


@pytest.mark.parametrize('bad_nodes,bad_edges', [
    (nodes((1, 1)), []),
    (nodes(), [{'source': 100, 'target': 999, 'distance': 1}]),
    ([{'id': 9, 'lat': 0}], []),
    (nodes(), [{'source': 100, 'target': 500}]),
])
def test_invalid_build_never_partially_publishes(bad_nodes, bad_edges):
    builder = TrafficGraphBuilder()
    previous = builder.build_graph(nodes(), edges())
    with pytest.raises((ValueError, KeyError)):
        builder.build_graph(bad_nodes, bad_edges)
    assert builder.graph is previous
    assert list(previous.nodes) == [100, 500]
    assert previous.number_of_edges() == 1


@pytest.mark.parametrize('count', [0, 1, 3])
def test_empty_isolated_topology_shapes(count):
    builder = TrafficGraphBuilder()
    graph = builder.build_graph(nodes(tuple(range(count))), [])
    data = builder.get_pytorch_data(graph)
    assert data.x.shape == (count, 5)
    assert data.edge_index.shape == (2, 0)
    assert data.node_map == {i: i for i in range(count)}


def test_concurrent_exports_keep_explicit_graph_identity():
    builder = TrafficGraphBuilder()
    graphs = [builder.build_graph(nodes((i * 100, i * 100 + 50)), edges((i * 100, i * 100 + 50))) for i in range(1, 13)]
    with ThreadPoolExecutor(max_workers=4) as pool:
        outputs = list(pool.map(builder.get_pytorch_data, graphs))
    for i, data in enumerate(outputs, 1):
        assert data.node_map == {i * 100: 0, i * 100 + 50: 1}
        assert data.edge_index.tolist() == [[0, 1], [1, 0]]


@pytest.mark.asyncio
async def test_actual_asgi_requests_never_share_prior_topology(monkeypatch):
    legacy = TrafficGraphBuilder()
    legacy.build_graph(nodes((-1, -2)), edges((-1, -2)))
    monkeypatch.setattr(r, 'builder', legacy)
    application = FastAPI()
    application.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
        for ids in [(100, 500), (7, 9)]:
            response = await client.post('/gat/build-graph', json={'nodes': nodes(ids), 'edges': edges(ids)})
            assert response.status_code == 200, response.text
            assert response.json()['data'] == {'nodes': 2, 'edges': 1, 'features': [2, 5], 'is_connected': True}
        empty = await client.post('/gat/build-graph', json={'nodes': [], 'edges': []})
        assert empty.status_code == 200
        assert empty.json()['data'] == {'nodes': 0, 'edges': 0, 'features': [0, 5], 'is_connected': False}
    assert list(legacy.graph.nodes) == [-1, -2]


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['build-graph', 'predict', 'train'])
@pytest.mark.parametrize('body', [{'nodes': nodes((1, 1)), 'edges': []}, {'nodes': nodes(), 'edges': [{'source': 100, 'target': 999, 'distance': 1}]}])
async def test_invalid_topology_rejected_as_body_validation(path, body):
    application = FastAPI()
    application.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
        response = await client.post('/gat/' + path, json=body)
    assert response.status_code == 422
    assert response.json()['detail'][0]['loc'][0] == 'body'


def test_raw_feature_units_remain_existing_gat_contract():
    builder = TrafficGraphBuilder()
    graph = builder.build_graph(nodes(), edges())
    data = builder.get_pytorch_data(graph)
    torch.testing.assert_close(data.x[0], torch.tensor([0.2, 0.8, 0.6, 0., 0.]))
    assert isinstance(data.graph, nx.Graph)
