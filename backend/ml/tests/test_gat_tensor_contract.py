"""Native Torch/PyG shape, graph independence and trainer/ASGI regressions."""
import math

import httpx
import pytest
import torch
from fastapi import FastAPI
from gat.model import GATTrainer, SpatialTemporalGAT, TrafficGraphBuilder


def model():
    torch.manual_seed(42)
    return SpatialTemporalGAT(in_features=5, hidden_features=16, out_features=8,
                             num_heads=2, num_layers=2, prediction_horizon=3)


def edges():
    return torch.tensor([[0, 1], [1, 0]], dtype=torch.long)


def data():
    builder = TrafficGraphBuilder()
    builder.build_graph([{'id': 0, 'lat': 0, 'lng': 0}, {'id': 1, 'lat': 1, 'lng': 1}],
                        [{'source': 0, 'target': 1, 'distance': 1}])
    return builder.get_pytorch_data()


@pytest.mark.parametrize('shape', [(2, 5), (1, 2, 1, 5), (2, 2, 3, 5), (3, 4, 2, 5)])
def test_native_forward_contract(shape):
    output = model().eval()(torch.ones(shape), edges())
    expected = (1, 2, 3) if len(shape) == 2 else (shape[0], shape[1], 3)
    assert output.shape == expected
    assert torch.isfinite(output).all()


@pytest.mark.parametrize('time', [1, 3])
def test_native_batch_matches_independent_graph_predictions(time):
    network = model().eval()
    x = torch.randn(3, 2, time, 5)
    together = network(x, edges())
    independent = torch.cat([network(x[i:i + 1], edges()) for i in range(3)])
    torch.testing.assert_close(together, independent, rtol=1e-5, atol=1e-6)
    altered = x.clone()
    altered[0] += 100
    torch.testing.assert_close(network(altered, edges())[1:], together[1:], rtol=1e-5, atol=1e-6)


def test_all_temporal_and_batch_graphs_receive_correctly_offset_native_edges():
    network = model().eval()
    observed = []
    handle = network.spatial_layers[0].register_forward_pre_hook(
        lambda layer, args: observed.append((args[0].shape, args[1].clone())))
    try:
        network(torch.ones(2, 2, 3, 5), edges())
    finally:
        handle.remove()
    assert len(observed) == 3
    for shape, actual in observed:
        assert shape == (4, 5)
        assert actual.tolist() == [[0, 1, 2, 3], [1, 0, 3, 2]]


def test_native_temporal_backprop_reaches_earlier_input_steps():
    network = model().eval()
    x = torch.randn(2, 2, 3, 5, requires_grad=True)
    network(x, edges()).sum().backward()
    assert torch.isfinite(x.grad).all()
    assert x.grad[:, :, 0].abs().sum() > 0
    assert x.grad[:, :, -1].abs().sum() > 0


@pytest.mark.parametrize('shape', [(1, 2, 0, 5), (0, 2, 1, 5), (1, 0, 1, 5), (2, 3, 5), (1, 2, 1, 4)])
def test_invalid_input_contract_has_explicit_failure(shape):
    with pytest.raises(ValueError):
        model()(torch.ones(shape), edges())


def test_empty_edges_are_valid_native_graphs():
    result = model().eval()(torch.ones(2, 2, 3, 5), torch.empty((2, 0), dtype=torch.long))
    assert result.shape == (2, 2, 3)
    assert torch.isfinite(result).all()


@pytest.mark.parametrize('edge_index', [torch.tensor([[0, 2], [1, 0]]), torch.tensor([[-1], [0]]), torch.tensor([0, 1])])
def test_invalid_edge_topology_is_rejected(edge_index):
    with pytest.raises(ValueError):
        model()(torch.ones(1, 2, 1, 5), edge_index)


@pytest.mark.parametrize('target_shape', [(2, 3), (1, 2, 3)])
def test_real_builder_train_validate_predict(target_shape):
    trainer = GATTrainer(model())
    sample = data()
    before = sample.x.clone()
    targets = torch.ones(target_shape)
    weight = next(trainer.model.parameters()).detach().clone()
    loss = trainer.train_step(sample, targets)
    assert math.isfinite(loss)
    assert not torch.equal(weight, next(trainer.model.parameters()))
    assert math.isfinite(trainer.validate(sample, targets))
    prediction = trainer.predict(sample)
    assert prediction['predictions'].shape == (1, 2, 3)
    torch.testing.assert_close(sample.x, before)


def test_target_mismatch_never_broadcasts_training_loss():
    trainer = GATTrainer(model())
    with pytest.raises(ValueError, match='targets must match'):
        trainer.train_step(data(), torch.zeros(1, 3))


@pytest.mark.asyncio
async def test_real_gat_predict_asgi_route_with_native_torch(monkeypatch):
    from routes import gat_routes
    monkeypatch.setattr(gat_routes, 'trainer', GATTrainer(model()))
    monkeypatch.setattr(gat_routes, 'builder', TrafficGraphBuilder())
    application = FastAPI()
    application.include_router(gat_routes.router)
    body = {'nodes': [{'id': 0, 'lat': 0, 'lng': 0}, {'id': 1, 'lat': 1, 'lng': 1}],
            'edges': [{'source': 0, 'target': 1, 'distance': 1}]}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
        response = await client.post('/gat/predict', json=body)
    assert response.status_code == 200, response.text
    assert response.json()['success'] is True
    assert len(response.json()['data']['predictions'][0]) == 2
    assert response.json()['data']['horizon'] == 3
