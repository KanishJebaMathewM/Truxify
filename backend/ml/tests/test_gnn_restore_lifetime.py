"""Real Torch/PyG checkpoint publication and native reader regressions."""
import threading
from concurrent.futures import ThreadPoolExecutor

import networkx as nx
import pytest
import torch
from gnn.models import RouteOptimizer
from torch_geometric.data import Data


def graph():
    # Native PyG consumer data; the unrelated builder override currently has
    # an extract_features(graph) signature mismatch on upstream main.
    network = nx.Graph()
    network.add_edge('A', 'B', distance=10., time=15.)
    return Data(
        x=torch.tensor([[12., 77., 0., 1., 0., 0., 0., 0., 50.],
                        [13., 78., 0., 1., 0., 0., 0., 0., 50.]]),
        edge_index=torch.tensor([[0, 1], [1, 0]], dtype=torch.long),
        edge_attr=torch.tensor([[10., 15., 0., 0., 0.], [10., 15., 0., 0., 0.]]),
        graph=network, node_map={'A': 0, 'B': 1},
    )


def serving():
    torch.manual_seed(42)
    optimizer = RouteOptimizer(allow_untrained=True)
    optimizer.feature_scaler.fit([graph()])
    optimizer.model.eval()
    optimizer.is_trained = True
    return optimizer


def embeddings(optimizer, data):
    transformed = optimizer.feature_scaler.transform_graph(data.clone())
    with torch.no_grad():
        return optimizer.model(transformed.x, transformed.edge_index, transformed.edge_attr).clone()


@pytest.mark.parametrize('broken', ['missing_scaler_fields', 'unfitted_scaler', 'missing_weights', 'tensor_shape', 'node_width', 'edge_width', 'zero_scale', 'negative_scale', 'nan_mean', 'infinite_scale'])
def test_failed_checkpoint_load_keeps_complete_serving_generation(broken, tmp_path):
    subject = serving()
    old_model, old_scaler = subject.model, subject.feature_scaler
    before = embeddings(subject, graph())
    state = {'state_dict': old_model.state_dict(), 'feature_scaler': old_scaler.state_dict()}
    if broken == 'missing_scaler_fields':
        state['feature_scaler'] = {'fitted': True}
    elif broken == 'unfitted_scaler':
        state['feature_scaler']['fitted'] = False
    elif broken == 'missing_weights':
        state['state_dict'] = {}
    elif broken == 'node_width':
        state['feature_scaler']['node_mean'] = [1.]
    elif broken == 'edge_width':
        state['feature_scaler']['edge_scale'] = [1.]
    elif broken == 'zero_scale':
        state['feature_scaler']['node_scale'][0] = 0.
    elif broken == 'negative_scale':
        state['feature_scaler']['edge_scale'][0] = -1.
    elif broken == 'nan_mean':
        state['feature_scaler']['node_mean'][0] = float('nan')
    elif broken == 'infinite_scale':
        state['feature_scaler']['edge_scale'][0] = float('inf')
    else:
        state['state_dict'] = dict(state['state_dict'])
        state['state_dict']['lin2.weight'] = torch.zeros(2, 2)
    path = tmp_path / 'invalid.pth'
    torch.save(state, path)
    with pytest.raises((ValueError, RuntimeError)):
        subject.load_model(path)
    assert subject.model is old_model
    assert subject.feature_scaler is old_scaler
    assert subject.is_trained and not subject.model.training
    torch.testing.assert_close(embeddings(subject, graph()), before)


def test_route_reader_uses_captured_scaler_and_model_during_load(tmp_path):
    subject = serving()
    data = graph()
    old_model, old_scaler = subject.model, subject.feature_scaler
    expected = embeddings(subject, data)
    replacement = serving()
    with torch.no_grad():
        replacement.model.lin2.bias.add_(10.)
    replacement.feature_scaler.node_mean.add_(100.)
    path = tmp_path / 'new.pth'
    replacement.save_model(path)
    entered, release = threading.Event(), threading.Event()
    real_transform = old_scaler.transform_graph
    def paused_transform(data):
        result = real_transform(data)
        if threading.current_thread().name.startswith('native-route'):
            entered.set()
            assert release.wait(10)
        return result
    old_scaler.transform_graph = paused_transform
    captured = []
    handle = old_model.register_forward_hook(lambda model, args, output: captured.append(output.detach().clone()))
    with ThreadPoolExecutor(1, thread_name_prefix='native-route') as pool:
        pending = pool.submit(subject.optimize_route, 'A', 'A', data, ['time'])
        try:
            assert entered.wait(10)
            subject.load_model(path)
            assert subject.model is not old_model
        finally:
            release.set()
        assert pending.result(10)['success']
    handle.remove()
    assert len(captured) == 1
    torch.testing.assert_close(captured[0], expected)
    assert not subject.model.training
    assert subject.feature_scaler is not old_scaler


def test_failed_native_training_keeps_scaler_and_model(monkeypatch):
    subject = serving()
    old_model, old_scaler = subject.model, subject.feature_scaler
    before = embeddings(subject, graph())
    def fail(*args, **kwargs):
        raise RuntimeError('native optimizer failed')
    monkeypatch.setattr(torch.optim.Adam, 'step', fail)
    with pytest.raises(RuntimeError, match='native optimizer failed'):
        subject.train([graph()], epochs=1)
    assert subject.model is old_model and subject.feature_scaler is old_scaler
    torch.testing.assert_close(embeddings(subject, graph()), before)


def test_checkpoint_save_owns_old_model_and_scaler_through_training(monkeypatch, tmp_path):
    subject = serving()
    expected = embeddings(subject, graph())
    expected_scaler = subject.feature_scaler.state_dict()
    path = tmp_path / 'old.pth'
    entered, release = threading.Event(), threading.Event()
    real_save = torch.save
    def paused_save(state, path):
        entered.set()
        assert release.wait(10)
        real_save(state, path)
    monkeypatch.setattr(torch, 'save', paused_save)
    with ThreadPoolExecutor(1) as pool:
        pending = pool.submit(subject.save_model, path)
        try:
            assert entered.wait(10)
            subject.train([graph()], epochs=1)
        finally:
            release.set()
        pending.result(10)
    restored = serving()
    restored.load_model(path)
    assert restored.feature_scaler.state_dict() == expected_scaler
    torch.testing.assert_close(embeddings(restored, graph()), expected)


@pytest.mark.parametrize('valid', [True, False])
def test_actual_load_endpoint_keeps_or_publishes_complete_model(valid, tmp_path, monkeypatch):
    import asyncio
    import importlib.util
    from pathlib import Path

    from fastapi import HTTPException

    # Execute the actual decorated endpoint source; importing the complete
    # routes registry also imports unrelated optional ML providers.
    path = Path(__file__).parents[1] / 'routes' / 'gnn_routes.py'
    spec = importlib.util.spec_from_file_location('native_gnn_restore_routes', path)
    routes = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(routes)
    subject = serving()
    old_model, old_scaler = subject.model, subject.feature_scaler
    replacement = serving()
    with torch.no_grad():
        replacement.model.lin2.bias.add_(3.)
    state = {'state_dict': replacement.model.state_dict(), 'feature_scaler': replacement.feature_scaler.state_dict()}
    if not valid:
        state['feature_scaler'] = {'fitted': True}
    monkeypatch.chdir(tmp_path)
    (tmp_path / 'models').mkdir()
    torch.save(state, tmp_path / 'models' / 'native.pth')
    if valid:
        result = asyncio.run(routes.load_model('native.pth', route_optimizer=subject))
        assert result['success']
        assert subject.model is not old_model
        torch.testing.assert_close(subject.model.lin2.bias, replacement.model.lin2.bias)
    else:
        with pytest.raises(HTTPException) as caught:
            asyncio.run(routes.load_model('native.pth', route_optimizer=subject))
        assert caught.value.status_code == 500
        assert subject.model is old_model
        assert subject.feature_scaler is old_scaler
    assert subject.is_trained and not subject.model.training
