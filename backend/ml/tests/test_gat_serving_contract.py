"""Actual PyG graph identity, gradients, bounded temporal work and finite summaries."""

import asyncio
import copy
import importlib
import sys
import threading

import httpx
import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from gat.model import GATTrainer, SpatialTemporalGAT
from gat.serving_contract import GATGraphInputError, graph_policy
from torch_geometric.data import Data


def native(dtype=torch.float32):
    torch.manual_seed(18)
    model = SpatialTemporalGAT(5, 8, 8, num_heads=2, num_layers=1, prediction_horizon=2).to(dtype)
    # Keep the real prediction head's ReLU active for gradient references;
    # an arbitrary random all-negative head can have a valid zero Jacobian.
    with torch.no_grad():
        model.prediction_head[0].bias.fill_(2)
    return model


def graph(dtype=torch.float32, batch=2, nodes=3, steps=2):
    return torch.arange(batch * nodes * steps * 5, dtype=dtype).reshape(batch, nodes, steps, 5) / 100, torch.tensor([[0, 1], [1, 2]])


def modes(model):
    return [m.training for m in model.modules()]


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_actual_pyg_batched_graph_and_feature_gradient_equal_independent_samples(dtype):
    model = native(dtype).eval()
    x, edges = graph(dtype)
    x.requires_grad_()
    actual = model(x, edges)
    expected = torch.cat([model(x[i:i+1], edges) for i in range(len(x))])
    torch.testing.assert_close(actual, expected, rtol=2e-5, atol=1e-7)
    a = torch.autograd.grad(actual.square().sum(), x, retain_graph=True)[0]
    b = torch.autograd.grad(expected.square().sum(), x)[0]
    torch.testing.assert_close(a, b, rtol=2e-5, atol=1e-7)
    assert torch.isfinite(a).all() and a.abs().sum() > 0


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
@pytest.mark.parametrize('nodes', [1, 2, 3])
def test_actual_node_population_statistics_match_numpy_and_restore_mixed_modes(dtype, nodes):
    model = native(dtype)
    model.lstm.eval()
    x = torch.ones(1, nodes, 1, 5, dtype=dtype)
    edges = torch.empty(2, 0, dtype=torch.long)
    prior = modes(model)
    weights = copy.deepcopy(model.state_dict())
    for p in model.parameters():
        p.grad = torch.full_like(p, 7)
    gradients = [p.grad.clone() for p in model.parameters()]
    result = model.predict_traffic(x, edges)
    values = result['predictions'].cpu().numpy().astype(np.float64)
    np.testing.assert_allclose(result['mean'].cpu().numpy(), values.mean(axis=1), rtol=1e-6, atol=1e-7)
    np.testing.assert_allclose(result['std'].cpu().numpy(), values.std(axis=1), rtol=1e-6, atol=1e-7)
    assert torch.isfinite(result['std']).all()
    if nodes == 1:
        assert torch.equal(result['std'], torch.zeros_like(result['std']))
    assert modes(model) == prior
    for name, value in weights.items():
        torch.testing.assert_close(model.state_dict()[name], value, rtol=0, atol=0)
    for p, g in zip(model.parameters(), gradients):
        torch.testing.assert_close(p.grad, g, rtol=0, atol=0)


@pytest.mark.parametrize('dtype,bias', [(torch.float32, 3e38), (torch.float64, 1e308)])
def test_actual_large_finite_native_output_does_not_overflow_summary_reduction(dtype, bias):
    model = native(dtype)
    with torch.no_grad():
        model.prediction_head[-1].weight.zero_()
        model.prediction_head[-1].bias.fill_(bias)
    result = model.predict_traffic(torch.zeros(1, 3, 1, 5, dtype=dtype), torch.empty(2, 0, dtype=torch.long))
    torch.testing.assert_close(result['mean'], model.prediction_head[-1].bias[None], rtol=0, atol=0)
    assert torch.equal(result['std'], torch.zeros_like(result['std']))


@pytest.mark.parametrize('bad_edges', [torch.tensor([[.5], [1.5]]), torch.tensor([[True], [False]]),
    torch.tensor([[-1], [1]]), torch.tensor([[0], [3]]), torch.tensor([0, 1]), torch.empty(3, 0, dtype=torch.long)])
def test_topology_rejected_before_pyg_or_mode_mutation(bad_edges):
    model = native()
    x, _ = graph()
    prior = modes(model)
    calls = []
    hook = model.spatial_layers[0].register_forward_pre_hook(lambda *args: calls.append(1))
    try:
        with pytest.raises(GATGraphInputError):
            model.predict_traffic(x, bad_edges)
    finally:
        hook.remove()
    assert calls == [] and modes(model) == prior


@pytest.mark.parametrize('kind', ['empty', 'nonfinite', 'dtype', 'time-extra', 'attention-work', 'node-limit'])
def test_complete_input_work_admission_precedes_native_allocations(kind):
    model = native()
    x, edges = graph()
    extra = None
    if kind == 'empty':
        x = x[:, :0]
    elif kind == 'nonfinite':
        x[-1, -1, -1, -1] = float('nan')
    elif kind == 'dtype':
        x = x.double()
    elif kind == 'time-extra':
        extra = torch.ones(2, 2)
    elif kind == 'attention-work':
        x = torch.zeros(1, 1024, 128, 5)
    else:
        x = torch.zeros(1, 4097, 1, 5)
    prior = modes(model)
    with pytest.raises(GATGraphInputError):
        model.predict_traffic(x, edges, extra)
    assert modes(model) == prior


def test_replicated_edge_and_parameter_work_rejected_without_allocating_batches():
    model = native()
    with pytest.raises(GATGraphInputError, match='replicated edge'):
        graph_policy(model, 64, 1, 1, 1000000)
    default = SpatialTemporalGAT()
    with pytest.raises(GATGraphInputError, match='work'):
        graph_policy(default, 1, 4096, 1, 0)


def test_caller_feature_and_topology_mutation_cannot_replace_admitted_graph():
    model = native().eval()
    x, edges = graph()
    expected = model.predict_traffic(x.clone(), edges.clone())
    def mutation(*args):
        x.fill_(100)
        edges.fill_(0)
    hook = model.spatial_layers[0].register_forward_pre_hook(mutation)
    try:
        result = model.predict_traffic(x, edges)
    finally:
        hook.remove()
    for name in result:
        torch.testing.assert_close(result[name], expected[name], rtol=0, atol=0)
    assert x.eq(100).all() and edges.eq(0).all()


def test_native_failure_restores_every_previous_mode():
    model = native()
    model.lstm.eval()
    prior = modes(model)
    def failure(*args):
        raise RuntimeError('controlled PyG callback')
    hook = model.spatial_layers[0].register_forward_pre_hook(failure)
    try:
        with pytest.raises(RuntimeError, match='controlled PyG'):
            model.predict_traffic(*graph())
    finally:
        hook.remove()
    assert modes(model) == prior


def test_trainer_serving_consumer_uses_same_finite_singleton_and_modes():
    model = native()
    model.lstm.eval()
    t = GATTrainer(model, device='cpu')
    prior = modes(model)
    result = t.predict(Data(x=torch.zeros(1, 5), edge_index=torch.empty(2, 0, dtype=torch.long)))
    assert result['predictions'].shape == (1, 1, 2)
    assert np.array_equal(result['std'], np.zeros((1, 2)))
    assert modes(model) == prior


@pytest.fixture
def mounted():
    name = 'routes.gat_routes'
    previous = sys.modules.pop(name, None)
    route = importlib.import_module(name)
    app = FastAPI()
    app.include_router(route.router)
    yield TestClient(app), route
    sys.modules.pop(name, None)
    if previous is not None:
        sys.modules[name] = previous


def payload(nodes=1):
    return {'nodes': [{'id': 7 + i, 'lat': 1., 'lng': 2.} for i in range(nodes)], 'edges': []}


def test_actual_default_native_mounted_singleton_serializes_finite_population(mounted):
    client, route = mounted
    route.trainer.model.lstm.eval()
    prior = modes(route.trainer.model)
    response = client.post('/gat/predict', json=payload())
    assert response.status_code == 200, response.text
    result = response.json()['data']
    assert np.asarray(result['predictions']).shape == (1, 1, 6)
    assert result['std'] == [[0.] * 6]
    assert modes(route.trainer.model) == prior


@pytest.mark.parametrize('kind', ['empty', 'bool-id', 'null-speed', 'nonrepresentable', 'budget'])
def test_actual_mounted_invalid_records_are422_before_model_state_mutation(mounted, kind):
    client, route = mounted
    body = payload()
    if kind == 'empty':
        body['nodes'] = []
    elif kind == 'bool-id':
        body['nodes'][0]['id'] = True
    elif kind == 'null-speed':
        body['nodes'][0]['speed'] = None
    elif kind == 'nonrepresentable':
        body['nodes'][0]['traffic'] = 1e300
    else:
        body = payload(4096)
    prior = modes(route.trainer.model)
    response = client.post('/gat/predict', json=body)
    assert response.status_code == 422, response.text
    assert modes(route.trainer.model) == prior


def test_actual_native_nonfinite_prediction_is_generic500(mounted):
    client, route = mounted
    with torch.no_grad():
        route.trainer.model.prediction_head[-1].bias.fill_(float('nan'))
    prior = modes(route.trainer.model)
    response = client.post('/gat/predict', json=payload())
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'
    assert modes(route.trainer.model) == prior


@pytest.mark.asyncio
async def test_worker_prediction_holds_native_generation_through_overlapping_prediction(mounted):
    _, route = mounted
    route.trainer = GATTrainer(native(), device='cpu')
    entered, release = threading.Event(), threading.Event()
    calls = []
    def pause(module, args):
        calls.append(threading.get_ident())
        if len(calls) == 1:
            entered.set()
            assert release.wait(3)
    hook = route.trainer.model.spatial_layers[0].register_forward_pre_hook(pause)
    watchdog = threading.Timer(2, release.set)
    watchdog.start()
    app = FastAPI()
    app.include_router(route.router)
    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            first = asyncio.create_task(client.post('/gat/predict', json=payload()))
            assert await asyncio.to_thread(entered.wait, 1)
            assert not release.is_set() and calls[0] != threading.get_ident()
            second = asyncio.create_task(client.post('/gat/predict', json=payload(2)))
            await asyncio.sleep(.05)
            assert not second.done() and len(calls) == 1
            release.set()
            assert (await asyncio.wait_for(first, 3)).status_code == 200
            assert (await asyncio.wait_for(second, 3)).status_code == 200
    finally:
        release.set()
        watchdog.cancel()
        hook.remove()


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_nonconstant_real_native_population_spread_matches_independent_numpy(dtype):
    model = native(dtype)
    result = model.predict_traffic(*graph(dtype))
    values = result['predictions'].cpu().numpy().astype(np.float64)
    assert values.std(axis=1).max() > 0
    np.testing.assert_allclose(result['mean'].cpu().numpy(), values.mean(axis=1), rtol=2e-6, atol=1e-9)
    np.testing.assert_allclose(result['std'].cpu().numpy(), values.std(axis=1), rtol=2e-6, atol=1e-9)
