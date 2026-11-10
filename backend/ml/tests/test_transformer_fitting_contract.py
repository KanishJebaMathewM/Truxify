"""Actual native fitting candidates, owned observations and mounted train consumers."""

import copy
import importlib
import json

import numpy as np
import pytest
import torch
from fastapi import FastAPI
from fastapi.testclient import TestClient
from transformers.model import DemandForecastTransformer, TransformerTrainer
from transformers.training_contract import ForecastAdmissionError


def setup(dtype=torch.float32):
    torch.manual_seed(81)
    model = DemandForecastTransformer(input_dim=1, d_model=8, num_heads=2, num_layers=1,
                                      seq_len=2, pred_len=2, dropout=0).to(dtype)
    return TransformerTrainer(model, device='cpu')


def data(dtype=torch.float32):
    return torch.tensor([[[.1], [.2]]], dtype=dtype), torch.tensor([[.3, .4]], dtype=dtype)


def equal(a, b):
    if isinstance(a, torch.Tensor):
        torch.testing.assert_close(a, b, rtol=0, atol=0)
    elif isinstance(a, dict):
        assert a.keys() == b.keys()
        for k in a:
            equal(a[k], b[k])
    elif isinstance(a, (tuple, list)):
        assert len(a) == len(b)
        for x, y in zip(a, b):
            equal(x, y)
    else:
        assert a == b


def snapshot(trainer):
    return (copy.deepcopy(trainer.model.state_dict()), copy.deepcopy(trainer.optimizer.state_dict()),
            [None if p.grad is None else p.grad.clone() for p in trainer.model.parameters()],
            [m.training for m in trainer.model.modules()])


def reference(model, optimizer, x, y):
    model.train()
    optimizer.zero_grad()
    predictions = model(x)
    objective = torch.nn.functional.mse_loss(predictions, y)
    objective.backward()
    torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0, error_if_nonfinite=True)
    optimizer.step()
    model.eval()
    return objective.item()


@pytest.mark.parametrize('dtype', [torch.float32, torch.float64])
def test_accepted_native_generation_matches_independent_mse_clip_adamw(dtype):
    subject = setup(dtype)
    old = subject.model
    model = copy.deepcopy(old)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    x, y = data(dtype)
    expected = reference(model, optimizer, x, y)
    result = subject.train(x, y, epochs=1, batch_size=1, val_data=x, val_labels=y)
    assert result['final_loss'] == expected
    assert result['final_val_loss'] == torch.nn.functional.mse_loss(model(x), y).item()
    equal(subject.model.state_dict(), model.state_dict())
    equal(subject.optimizer.state_dict(), optimizer.state_dict())
    assert subject.model is not old
    json.dumps(result, allow_nan=False)


def test_real_finite_policy_overflow_preserves_exact_old_pair_then_corrected_retry():
    subject = setup()
    x, y = data()
    subject.train(x, y, epochs=1, batch_size=1)
    subject.optimizer.param_groups[0].update(lr=1e20, weight_decay=1e20)
    old_model, old_optimizer = subject.model, subject.optimizer
    before, predictions = snapshot(subject), subject.predict(x)
    with pytest.raises(ValueError, match='nonfinite'):
        subject.train(x, y, epochs=1, batch_size=1)
    assert subject.model is old_model and subject.optimizer is old_optimizer
    equal(snapshot(subject), before)
    np.testing.assert_array_equal(subject.predict(x), predictions)
    subject.optimizer.param_groups[0].update(lr=1e-4, weight_decay=.01)
    model = copy.deepcopy(subject.model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    optimizer.load_state_dict(copy.deepcopy(subject.optimizer.state_dict()))
    expected = reference(model, optimizer, x, y)
    assert subject.train(x, y, 1, 1)['final_loss'] == expected
    equal(subject.model.state_dict(), model.state_dict())
    equal(subject.optimizer.state_dict(), optimizer.state_dict())


@pytest.mark.parametrize('bad', ['train_nan', 'label_inf', 'late_val_nan', 'horizon',
                                'features', 'sequence', 'row_count', 'val_pair',
                                'empty_val', 'integer', 'epochs_bool', 'epochs_float',
                                'batch_zero', 'epochs_over500'])
def test_complete_rejection_before_clone_rng_or_serving_effects(bad, monkeypatch):
    subject = setup()
    x, y = data()
    vx, vy, epochs, batch_size = x.clone(), y.clone(), 1, 1
    if bad == 'train_nan':
        x[0, -1, 0] = float('nan')
    elif bad == 'label_inf':
        y[0, -1] = float('inf')
    elif bad == 'late_val_nan':
        vx[0, -1, 0] = float('nan')
    elif bad == 'horizon':
        y = y[:, :1]
    elif bad == 'features':
        x = torch.ones((1, 2, 2))
    elif bad == 'sequence':
        x = torch.ones((1, 5, 1))
    elif bad == 'row_count':
        y = y.repeat(2, 1)
    elif bad == 'val_pair':
        vy = None
    elif bad == 'empty_val':
        vx, vy = vx[:0], vy[:0]
    elif bad == 'integer':
        x = x.long()
    elif bad == 'epochs_bool':
        epochs = True
    elif bad == 'epochs_float':
        epochs = 1.5
    elif bad == 'batch_zero':
        batch_size = 0
    else:
        epochs = 501
    calls = []
    native = subject._working_generation

    def working():
        calls.append('clone')
        return native()

    monkeypatch.setattr(subject, '_working_generation', working)
    before, rng = snapshot(subject), torch.get_rng_state().clone()
    with pytest.raises(ForecastAdmissionError):
        subject.train(x, y, epochs, batch_size, vx, vy)
    assert not calls
    equal(snapshot(subject), before)
    equal(torch.get_rng_state(), rng)


def test_complete_source_and_heldout_ownership_precedes_native_clone(monkeypatch):
    subject = setup()
    x, y = data()
    vx, vy = data()
    original = tuple(value.clone() for value in (x, y, vx, vy))
    native = subject._working_generation
    model = copy.deepcopy(subject.model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    losses = [reference(model, optimizer, *original[:2]) for _ in range(2)]

    def mutate():
        for value in (x, y, vx, vy):
            value.fill_(99)
        return native()

    monkeypatch.setattr(subject, '_working_generation', mutate)
    result = subject.train(x, y, 2, 1, vx, vy)
    assert result['train_losses'] == losses
    equal(subject.model.state_dict(), model.state_dict())
    assert result['final_val_loss'] == torch.nn.functional.mse_loss(model(original[2]), original[3]).item()


def test_generic_native_module_compatibility_without_broadcasting():
    subject = TransformerTrainer(torch.nn.Linear(2, 1), device='cpu')
    x, y = torch.ones((2, 2)), torch.ones((2, 1))
    assert np.isfinite(subject.train(x, y, 1, 2)['final_loss'])
    model, optimizer = subject.model, subject.optimizer
    with pytest.raises(ForecastAdmissionError, match='without broadcasting'):
        subject.train(x, torch.ones((2, 2)), 1, 2)
    assert subject.model is model and subject.optimizer is optimizer


@pytest.fixture(scope='module')
def route():
    # Actual route module/default native construction; no full optional registry.
    return importlib.import_module('routes.transformer_routes')


@pytest.mark.parametrize('kind', ['demand', 'traffic', 'price'])
@pytest.mark.parametrize('bad', ['horizon', 'ragged', 'nonfinite'])
def test_actual_three_training_routes_reject_client_observation_without_publication(route, kind, bad, monkeypatch):
    subject = setup()
    old_model, old_optimizer = subject.model, subject.optimizer
    monkeypatch.setattr(route, kind+'_trainer', subject)
    app = FastAPI()
    app.include_router(route.router)
    x, y = data()
    request = {'train_data': x.tolist(), 'train_labels': y.tolist(), 'epochs': 1, 'batch_size': 1}
    if bad == 'horizon':
        request['train_labels'] = [[.3]]
    elif bad == 'ragged':
        request['train_data'] = [[[.1], [.2, .3]]]
    else:
        request['train_data'][0][-1][0] = float('nan')
    with TestClient(app) as client:
        response = client.post('/transformer/'+kind+'/train', content=json.dumps(request),
                               headers={'Content-Type': 'application/json'})
    assert response.status_code == 422
    assert subject.model is old_model and subject.optimizer is old_optimizer


@pytest.mark.parametrize('kind', ['demand', 'traffic', 'price'])
def test_actual_training_route_retains_native_success_and_internal_overflow_500(route, kind, monkeypatch):
    subject = setup()
    monkeypatch.setattr(route, kind+'_trainer', subject)
    app = FastAPI()
    app.include_router(route.router)
    x, y = data()
    request = {'train_data': x.tolist(), 'train_labels': y.tolist(), 'epochs': 1, 'batch_size': 1}
    with TestClient(app) as client:
        response = client.post('/transformer/'+kind+'/train', json=request)
        assert response.status_code == 200
        json.dumps(response.json(), allow_nan=False)
        subject.optimizer.param_groups[0].update(lr=1e20, weight_decay=1e20)
        old_model, old_optimizer = subject.model, subject.optimizer
        response = client.post('/transformer/'+kind+'/train', json=request)
    assert response.status_code == 500
    assert response.json()['detail'] == 'Internal server error'
    assert subject.model is old_model and subject.optimizer is old_optimizer


def test_generic_native_integer_embedding_inputs_keep_existing_compatibility():
    torch.manual_seed(91)
    subject = TransformerTrainer(torch.nn.Embedding(4, 2), device='cpu')
    x, y = torch.tensor([[0, 1]]), torch.ones((1, 2, 2))
    model = copy.deepcopy(subject.model)
    optimizer = torch.optim.AdamW(model.parameters(), lr=1e-4)
    expected = reference(model, optimizer, x, y)
    assert subject.train(x, y, 1, 1)['final_loss'] == expected
    equal(subject.model.state_dict(), model.state_dict())
    equal(subject.optimizer.state_dict(), optimizer.state_dict())


@pytest.mark.parametrize('field,value', [('lr', float('inf')), ('weight_decay', -1.), ('betas', (.9, 1.))])
def test_prior_native_policy_rejected_before_rng_or_private_fit(field, value, monkeypatch):
    subject = setup()
    subject.optimizer.param_groups[0][field] = value
    model, optimizer = subject.model, subject.optimizer
    rng = torch.get_rng_state().clone()
    calls = []
    native = subject._working_generation

    def observe():
        calls.append('clone')
        return native()

    monkeypatch.setattr(subject, '_working_generation', observe)
    with pytest.raises(ValueError):
        subject.train(*data(), 1, 1)
    assert not calls
    equal(torch.get_rng_state(), rng)
    assert subject.model is model and subject.optimizer is optimizer


def test_finite_registered_candidate_with_nonfinite_actual_forecast_is_not_published():
    subject = setup()
    x, y = data()
    subject.optimizer.param_groups[0].update(lr=1e30, weight_decay=0.)
    old_model, old_optimizer = subject.model, subject.optimizer
    before = snapshot(subject)
    with pytest.raises(ValueError, match='finite'):
        subject.train(x, y, 1, 1)
    assert subject.model is old_model and subject.optimizer is old_optimizer
    equal(snapshot(subject), before)
