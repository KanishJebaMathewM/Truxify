"""Actual mounted ASGI, native TensorFlow/Redis and complete worker ownership."""

import asyncio
import importlib.util
import sys
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

import httpx
import numpy as np
import pytest
from app import execution
from fastapi import FastAPI
from federated import federated_client as client_module
from federated import http_execution
from tensorflow import keras
from test_federated_model_admission import native_redis as _native_redis_fixture

native_redis = _native_redis_fixture


@pytest.fixture
def context(native_redis, tmp_path, monkeypatch):
    connection, url = native_redis
    connection.flushdb()
    monkeypatch.setenv('REDIS_URL', url)
    monkeypatch.delenv('FEDERATED_ENCRYPTION_KEY', raising=False)
    monkeypatch.chdir(tmp_path)
    # Load the actual route source with private native Redis at construction,
    # without replacing another protocol test's cached module/server instance.
    spec = importlib.util.spec_from_file_location('native_federated_http_routes',
                Path(__file__).resolve().parents[1] / 'routes/federated_routes.py')
    module = importlib.util.module_from_spec(spec)
    monkeypatch.setitem(sys.modules, spec.name, module)
    spec.loader.exec_module(module)
    app = FastAPI()
    app.include_router(module.router)
    @app.get('/heartbeat')
    async def heartbeat():
        return {'alive': True}
    yield module, app, connection
    # Even a failed test must let the native job finish before closing its store.
    with http_execution._OWNER:
        pass
    # All clients share the server Redis pool: stop EVERY worker before closing it.
    threads = [c._sub_thread for c in module._clients.values() if c._sub_thread is not None]
    if module.server._consumer_thread is not None:
        threads.append(module.server._consumer_thread)
    for thread in threads:
        thread.stop()
    for thread in threads:
        thread.join(5)
    for client in module._clients.values():
        client.stop_subscription()
    module.server.stop_update_consumer()
    module.server.redis.close()


def selected(module, connection):
    connection.sadd('federated:clients', 'A', 'B', 'C')
    module.get_or_create_client('A')
    module.server.dp_noise_scale = 0.0
    module.server.start_round()


def http_client(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://native.test')


async def wait_for_native_acceptance(module):
    # HTTP publication can race the independently scheduled real Pub/Sub
    # consumer. Observe its confirmed outcome rather than assuming sync ack.
    for _ in range(500):
        if ('A', 1) in module.server.accepted_updates:
            return
        await asyncio.sleep(.01)
    pytest.fail('Native published client update was not eventually admitted')


@pytest.mark.asyncio
async def test_real_fit_runs_off_loop_and_publishes_observed_round(context, monkeypatch):
    module, app, connection = context
    selected(module, connection)
    pulses, calls = [], []
    original = keras.Model.fit
    def fit(model, *args, **kwargs):
        before = len(pulses)
        result = original(model, *args, **kwargs)
        calls.append((threading.get_ident(), before, len(pulses)))
        return result
    monkeypatch.setattr(keras.Model, 'fit', fit)
    async def ticker():
        while True:
            pulses.append(True)
            await asyncio.sleep(.001)
    pulse = asyncio.create_task(ticker())
    try:
        async with http_client(app) as http:
            response = await http.post('/federated/client/participate', json={'client_id': 'A', 'epochs': 1})
        assert response.status_code == 200 and response.json()['success']
        assert len(calls) == 1 and calls[0][0] != threading.get_ident()
        assert calls[0][2] > calls[0][1]
        await wait_for_native_acceptance(module)
        assert ('A', 1) in module.server.accepted_updates
        assert module._clients['A']._trained_round == 1 and module._clients['A']._published_round == 1
    finally:
        pulse.cancel()
        with pytest.raises(asyncio.CancelledError):
            await pulse


@pytest.mark.parametrize('deadline', [False, True])
@pytest.mark.asyncio
async def test_cancel_or_deadline_retains_native_owner_until_real_fit_finishes(context, monkeypatch, deadline):
    module, app, connection = context
    selected(module, connection)
    entered, release, finished = threading.Event(), threading.Event(), threading.Event()
    original = keras.Model.fit
    def gated_fit(model, *args, **kwargs):
        entered.set()
        assert release.wait(5)
        try:
            return original(model, *args, **kwargs)
        finally:
            finished.set()
    monkeypatch.setattr(keras.Model, 'fit', gated_fit)
    normal_deadline = execution.ML_INFERENCE_TIMEOUT_SECONDS
    monkeypatch.setattr(execution, 'ML_INFERENCE_TIMEOUT_SECONDS', .05 if deadline else 30)
    async with http_client(app) as http:
        request = asyncio.create_task(http.post('/federated/client/participate', json={'client_id': 'A', 'epochs': 1}))
        try:
            assert await asyncio.to_thread(entered.wait, 5)
            if deadline:
                assert (await request).status_code == 504
            else:
                request.cancel()
                with pytest.raises(asyncio.CancelledError):
                    await request
            # The short deadline applies to the intentionally expired request,
            # not unrelated normal reads after native ownership is released.
            monkeypatch.setattr(execution, 'ML_INFERENCE_TIMEOUT_SECONDS', normal_deadline)
            assert not finished.is_set()
            assert (await http.get('/heartbeat')).status_code == 200
            assert (await http.get('/federated/server/stats')).status_code == 503
            with execution._inference_guard:
                assert execution._active_inference >= 1
        finally:
            release.set()
        assert await asyncio.to_thread(finished.wait, 5)
        # Native fit completion precedes encryption/confirmation; the shared
        # owner's release is observed through a real subsequent HTTP operation.
        for _ in range(300):
            response = await http.get('/federated/server/stats')
            if response.status_code != 503:
                break
            await asyncio.sleep(.01)
        assert response.status_code == 200
        await wait_for_native_acceptance(module)
        assert ('A', 1) in module.server.accepted_updates
        assert module._clients['A']._published_round == 1


@pytest.mark.parametrize('path,payload', [
    ('/client/train', {'rounds': 0}), ('/client/train', {'rounds': -2}),
    ('/client/train', {'rounds': 10**9}), ('/client/train', {'rounds': True}),
    ('/client/train', {'rounds': '2'}), ('/client/train', {'rounds': 33, 'epochs': 2}),
    ('/client/participate', {'epochs': True}), ('/client/participate', {'epochs': '2'}),
    ('/client/participate', {'epochs': 0}), ('/client/participate', {'epochs': 17}),
    ('/client/register', {'client_id': ''}), ('/client/register', {'client_id': 'x'*257}),
    ('/client/register', {'client_id': '😀'*65}), ('/client/register', {'client_id': 7}),
])
@pytest.mark.asyncio
async def test_http_rejects_complete_counts_and_ids_before_native_client_work(context, path, payload):
    module, app, connection = context
    async with http_client(app) as http:
        response = await http.post('/federated'+path, json={'client_id': 'A', **payload})
    assert response.status_code == 422
    assert not module._clients and not connection.smembers('federated:clients')


def test_default_job_and_participation_have_distinct_work_policies(context):
    module, _, _ = context
    default = module.TrainRequest(client_id='A')
    assert (default.rounds, default.epochs) == (10, 5)
    assert module.TrainRequest(client_id='A', rounds=64, epochs=1).rounds == 64
    # Unused default rounds must not make a valid single-round participation fail.
    assert module.TrainingRequest(client_id='A', epochs=16).epochs == 16


@pytest.mark.asyncio
async def test_cache_capacity_preserves_native_identity_and_intended_503(context, monkeypatch):
    module, app, _ = context
    monkeypatch.setattr(http_execution, 'MAX_CACHED_CLIENTS', 1)
    async with http_client(app) as http:
        assert (await http.post('/federated/client/register', json={'client_id':'A'})).status_code == 200
        original = module._clients['A']
        assert original._sub_thread.is_alive()
        assert (await http.post('/federated/client/register', json={'client_id':'B'})).status_code == 503
        assert (await http.post('/federated/client/register', json={'client_id':'A'})).status_code == 200
    assert module._clients == {'A': original}


def test_concurrent_lookup_creates_one_actual_client_and_subscription(context, monkeypatch):
    module, _, _ = context
    entered, release, looking = threading.Event(), threading.Event(), threading.Event()
    original = client_module.FederatedClient._create_model
    calls = []
    def model(client):
        entered.set()
        assert release.wait(5)
        calls.append(True)
        return original(client)
    monkeypatch.setattr(client_module.FederatedClient, '_create_model', model)
    def lookup():
        looking.set()
        return module.get_or_create_client('A')
    with ThreadPoolExecutor(max_workers=2) as pool:
        one = pool.submit(module.get_or_create_client, 'A')
        assert entered.wait(5)
        two = pool.submit(lookup)
        assert looking.wait(5)
        try:
            assert not two.done()
        finally:
            release.set()
        left, right = one.result(timeout=5), two.result(timeout=5)
    assert left is right and len(calls) == 1 and left._sub_thread.is_alive()


@pytest.mark.parametrize('client_id', ['A', 'driver-β'])
def test_private_rng_preserves_frozen_serial_arrays_and_unrelated_stream(context, monkeypatch, client_id):
    module, _, _ = context
    client = module.get_or_create_client(client_id)
    monkeypatch.setattr(client_module, 'time', SimpleNamespace(time=lambda: 123456.0))
    seed = 456 + hash(client_id) % 1000
    expected = np.random.RandomState(seed).randn(100, 10)
    state = np.random.get_state()
    try:
        np.random.seed(941)
        before = np.random.get_state()
        untouched = np.random.random(8)
        np.random.set_state(before)
        actual, labels = client.simulate_driver_behavior()
        np.testing.assert_array_equal(actual, expected)
        np.testing.assert_array_equal(labels, (expected.sum(axis=1) > .5).astype(int))
        np.testing.assert_array_equal(np.random.random(8), untouched)
    finally:
        np.random.set_state(state)


@pytest.mark.asyncio
async def test_actual_two_round_http_job_retains_once_only_native_training(context, monkeypatch):
    module, app, connection = context
    selected(module, connection)
    original = keras.Model.fit
    calls = []
    def fit(model, *args, **kwargs):
        calls.append(threading.get_ident())
        return original(model, *args, **kwargs)
    monkeypatch.setattr(keras.Model, 'fit', fit)
    async with http_client(app) as http:
        response = await http.post('/federated/client/train', json={'client_id':'A', 'rounds':2, 'epochs':1})
    body = response.json()
    assert response.status_code == 200 and body['success'] and len(body['data']) == 2
    assert len(calls) == 1 and calls[0] != threading.get_ident()
    await wait_for_native_acceptance(module)


def test_concurrent_private_generators_match_independent_serial_references(context, monkeypatch):
    module, _, _ = context
    clients = [module.get_or_create_client(name) for name in ('A', 'B')]
    monkeypatch.setattr(client_module, 'time', SimpleNamespace(time=lambda:123456.0))
    state = np.random.get_state()
    try:
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda c: c.simulate_driver_behavior(), clients))
        for client, (data, labels) in zip(clients, results):
            expected = np.random.RandomState(456 + hash(client.client_id) % 1000).randn(100,10)
            np.testing.assert_array_equal(data, expected)
            np.testing.assert_array_equal(labels, (expected.sum(axis=1) > .5).astype(int))
        after = np.random.get_state()
        assert state[0] == after[0] and state[2:] == after[2:]
        np.testing.assert_array_equal(state[1], after[1])
    finally:
        np.random.set_state(state)
