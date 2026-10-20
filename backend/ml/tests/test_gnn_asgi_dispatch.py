"""Actual FastAPI registration/ASGI dispatch; native solver boundaries injected."""
import asyncio
import threading

import httpx
import networkx as nx
import pytest
from app import execution
from fastapi import FastAPI, HTTPException
from routes import _gnn_event_loop_isolation_patch  # noqa: F401
from routes import gnn_routes as r

PATHS = ['build-graph', 'optimize-route', 'multi-objective', 'update-route']
NODES = [{'id': 'a', 'lat': 0, 'lng': 0}, {'id': 'b', 'lat': 1, 'lng': 1}]
EDGES = [{'source': 'a', 'target': 'b', 'distance': 1, 'time': 1}]


def payload(path):
    body = {'nodes': NODES, 'edges': EDGES}
    if path == 'update-route':
        body.update(route=[{'from': 'a', 'to': 'b'}], traffic_data={})
    elif path != 'build-graph':
        body.update(start_node='a', end_node='b')
    return body


class Builder:
    def __init__(self):
        self.calls = []

    def build_road_network(self, nodes, edges):
        self.calls.append(threading.get_ident())
        graph = nx.DiGraph()
        graph.add_nodes_from(node['id'] for node in nodes)
        graph.add_edges_from((edge['source'], edge['target']) for edge in edges)
        return graph

    def get_pytorch_data(self, graph):
        assert list(graph.nodes) == ['a', 'b']
        return graph


class Optimizer:
    def __init__(self):
        self.calls = []

    def optimize_route(self, start, end, graph, objectives, constraints):
        self.calls.append(threading.get_ident())
        return {'route': [{'from': start, 'to': end}]}

    def _find_pareto_routes(self, start, end, graph, objectives, constraints):
        return [self.optimize_route(start, end, graph, objectives, constraints)]

    def real_time_update(self, route, traffic, **kwargs):
        self.calls.append(threading.get_ident())
        assert 'graph_data' in kwargs
        return route


@pytest.fixture
def app():
    application = FastAPI()
    application.include_router(r.router)
    application.state.builder = Builder()
    application.state.optimizer = Optimizer()
    application.dependency_overrides[r.get_graph_builder] = lambda: application.state.builder
    application.dependency_overrides[r.get_route_optimizer] = lambda: application.state.optimizer

    @application.get('/health')
    async def health():
        return {'ok': True}

    return application


@pytest.mark.parametrize('path', PATHS)
def test_mounted_schema_preserves_json_body_and_dependencies(app, path):
    operation = app.openapi()['paths']['/gnn/' + path]['post']
    assert 'requestBody' in operation
    assert not operation.get('parameters')
    route = next(route for route in app.routes if route.path == '/gnn/' + path)
    assert route.dependant.call is getattr(r, path.replace('-', '_') if path != 'multi-objective' else 'multi_objective_optimize')
    assert r.get_graph_builder in [dep.call for dep in route.dependant.dependencies]
    if path != 'build-graph':
        assert r.get_route_optimizer in [dep.call for dep in route.dependant.dependencies]


@pytest.mark.asyncio
@pytest.mark.parametrize('path', PATHS)
async def test_json_reaches_injected_native_dependencies_off_loop(app, path):
    loop_thread = threading.get_ident()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/' + path, json=payload(path))
    assert response.status_code == 200, response.text
    assert response.json()['success'] is True
    assert app.state.builder.calls and all(t != loop_thread for t in app.state.builder.calls)
    if path != 'build-graph':
        assert app.state.optimizer.calls and all(t != loop_thread for t in app.state.optimizer.calls)


@pytest.mark.asyncio
async def test_native_graph_builder_runs_real_networkx(app):
    app.dependency_overrides.pop(r.get_graph_builder)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/build-graph', json=payload('build-graph'))
    assert response.status_code == 200
    assert response.json()['data'] == {'nodes': 2, 'edges': 1, 'is_connected': True}


@pytest.mark.asyncio
@pytest.mark.parametrize('path', PATHS)
async def test_invalid_body_rejected_before_native_dispatch(app, path):
    body = payload(path)
    body['nodes'] = [{'id': 'a', 'lat': 91, 'lng': 0}]
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/' + path, json=body)
    assert response.status_code == 422
    assert not app.state.builder.calls


@pytest.mark.asyncio
@pytest.mark.parametrize('path', PATHS)
async def test_overload_remains_503(app, monkeypatch, path):
    async def saturated(*args, **kwargs):
        raise HTTPException(503, 'ML inference capacity exhausted; retry later')
    monkeypatch.setattr(r, 'run_inference', saturated)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/' + path, json=payload(path))
    assert response.status_code == 503
    assert not app.state.builder.calls


@pytest.mark.asyncio
@pytest.mark.parametrize('path', PATHS)
async def test_native_failure_is_redacted(app, path):
    def fail(*args):
        raise RuntimeError('private-native-detail')
    app.state.builder.build_road_network = fail
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/' + path, json=payload(path))
    assert response.status_code == 500
    assert response.json() == {'detail': 'Internal server error'}


@pytest.mark.asyncio
async def test_health_remains_responsive_and_native_capacity_is_shared(app):
    entered, release = threading.Event(), threading.Event()
    original = app.state.builder.build_road_network
    def blocked(*args):
        entered.set()
        assert release.wait(3)
        return original(*args)
    app.state.builder.build_road_network = blocked
    previous = {
        'max_concurrent': execution.ML_MAX_CONCURRENT_INFERENCE,
        'max_workers': execution.ML_INFERENCE_MAX_WORKERS,
        'queue_timeout': execution.ML_INFERENCE_QUEUE_TIMEOUT_SECONDS,
    }
    execution.configure(max_concurrent=1, max_workers=1, queue_timeout=0.03)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            task = asyncio.create_task(client.post('/gnn/build-graph', json=payload('build-graph')))
            try:
                assert await asyncio.to_thread(entered.wait, 2)
                health = await asyncio.wait_for(client.get('/health'), 0.3)
                assert health.status_code == 200
                overload = await client.post('/gnn/optimize-route', json=payload('optimize-route'))
                assert overload.status_code == 503
            finally:
                release.set()
                response = await task
            assert response.status_code == 200
    finally:
        release.set()
        execution.configure(**previous)


@pytest.mark.asyncio
@pytest.mark.parametrize('path', ['optimize-route', 'multi-objective', 'update-route'])
async def test_unsupported_objective_never_starts_native_work(app, path):
    body = payload(path)
    body['objectives'] = ['unsupported']
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/' + path, json=body)
    assert response.status_code == 422
    assert 'Unsupported route objective' in response.text
    assert not app.state.builder.calls


@pytest.mark.asyncio
async def test_empty_update_route_rejected_before_native_work(app):
    body = payload('update-route')
    body['route'] = []
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.post('/gnn/update-route', json=body)
    assert response.status_code == 422
    assert 'Route must contain' in response.text
    assert not app.state.builder.calls


@pytest.mark.asyncio
async def test_actual_registry_retains_auth_and_json_contract(monkeypatch):
    import routes
    monkeypatch.setattr(routes, 'ML_ROUTE_MODULES', [('gnn_routes', 'Graph Neural Networks')])
    monkeypatch.setenv('ML_API_KEY', 'local-asgi-test-only')
    application = FastAPI()
    assert routes.register_ml_routers(application) == ['gnn_routes']
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
        rejected = await client.post('/gnn/build-graph', json=payload('build-graph'))
        assert rejected.status_code == 401
        accepted = await client.post('/gnn/build-graph', json=payload('build-graph'), headers={'X-API-Key': 'local-asgi-test-only'})
        assert accepted.status_code == 200
        assert accepted.json()['data']['nodes'] == 2
