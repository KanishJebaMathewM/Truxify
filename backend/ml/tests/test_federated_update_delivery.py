"""Native Redis/Fernet/Keras delivery, acknowledgement and ownership controls."""

import json
import time
from concurrent.futures import ThreadPoolExecutor
from threading import Event

import pytest
import redis
from federated.federated_server import FederatedServer
from federated.round_recovery import SNAPSHOT_KEY
from federated.update_delivery import ACKNOWLEDGE
from test_federated_model_admission import native_redis as _native_redis_fixture

native_redis = _native_redis_fixture


@pytest.fixture
def context(native_redis, tmp_path, monkeypatch):
    connection, url = native_redis
    connection.flushdb()
    connection.sadd('federated:clients', 'A', 'B', 'C')
    monkeypatch.delenv('FEDERATED_ENCRYPTION_KEY', raising=False)
    monkeypatch.chdir(tmp_path)
    server = FederatedServer(url, min_clients=3, clients_per_round=3)
    server.dp_noise_scale = 0.0
    with monkeypatch.context() as scoped:
        scoped.setattr(server, 'start_update_consumer', lambda: None)
        server.start_round()
    yield server, connection
    if server._consumer_thread is not None:
        server._consumer_thread.stop()
        server._consumer_thread.join(5)
    server.stop_update_consumer()
    server.redis.close()


def envelope(server, *, round_id=None, weights=None):
    if weights is None:
        weights = [w.tolist() for w in server.model.get_weights()]
    return server.cipher.encrypt(json.dumps({'round': server.round if round_id is None else round_id,
                                           'weights': weights}).encode())


def queue(connection, client, data):
    key = f'federated:update:{client}'
    connection.setex(key, 3600, data)
    return key


def wait_until(predicate):
    deadline = time.monotonic() + 5
    while time.monotonic() < deadline:
        if predicate():
            return
        time.sleep(.01)
    pytest.fail('Native Pub/Sub delivery did not reach the asserted state')


def test_native_polling_admits_removes_and_completes_once(context):
    server, connection = context
    keys = [queue(connection, c, envelope(server)) for c in ('A', 'B')]
    assert server.drain_pending_client_updates() == 2
    assert set(server.client_weights) == {'A', 'B'}
    assert all(connection.get(k) is None for k in keys)
    assert server.drain_pending_client_updates() == 0
    final = queue(connection, 'C', envelope(server))
    assert server.drain_pending_client_updates() == 1
    assert server.round_completed and not server.client_weights
    assert connection.get(final) is None
    receipt = connection.get(SNAPSHOT_KEY)
    assert server.drain_pending_client_updates() == 0
    assert connection.get(SNAPSHOT_KEY) == receipt


@pytest.mark.parametrize('after_native_read', [False, True])
def test_read_failure_keeps_envelope_and_ttl_for_real_retry(context, monkeypatch, after_native_read):
    server, connection = context
    data = envelope(server)
    key = queue(connection, 'A', data)
    native = server.redis.get
    def failed_get(name, *args, **kwargs):
        if name == key:
            if after_native_read:
                native(name, *args, **kwargs)
            raise redis.ConnectionError('controlled native read/response failure')
        return native(name, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'get', failed_get)
        assert server.drain_pending_client_updates() == 0
    assert connection.get(key) == data and 3500 < connection.ttl(key) <= 3600
    assert not server.client_weights
    assert server.drain_pending_client_updates() == 1
    assert connection.get(key) is None and 'A' in server.client_weights


def test_native_snapshot_write_denial_retains_update_then_recovers(context):
    server, connection = context
    data = envelope(server)
    key = queue(connection, 'A', data)
    connection.execute_command('ACL', 'SETUSER', 'delivery-readonly', 'reset', 'on',
                               'nopass', '~*', '+get')
    restricted = redis.Redis(unix_socket_path=connection.connection_pool.connection_kwargs['path'],
                             username='delivery-readonly')
    original = server.redis
    try:
        server.redis = restricted
        assert server.drain_pending_client_updates() == 0
        assert not server.accepted_updates and not server.client_weights
        assert connection.get(key) == data
    finally:
        server.redis = original
        restricted.close()
    assert server.drain_pending_client_updates() == 1
    assert connection.get(key) is None and ('A', 1) in server.accepted_updates


@pytest.mark.parametrize('data_kind', ['invalid-token', 'malformed-model', 'stale', 'future'])
def test_rejected_payload_is_retained_without_quorum_or_ttl_refresh(context, data_kind):
    server, connection = context
    data = {'invalid-token': b'not-a-fernet-token', 'malformed-model': envelope(server, weights=[]),
            'stale': envelope(server, round_id=0), 'future': envelope(server, round_id=2)}[data_kind]
    key = queue(connection, 'A', data)
    connection.expire(key, 30)
    assert server.drain_pending_client_updates() == 0
    assert connection.get(key) == data and 0 < connection.ttl(key) <= 30
    assert not server.client_weights and not server.accepted_updates


@pytest.mark.parametrize('completed', [False, True])
@pytest.mark.parametrize('reply_lost', [False, True])
def test_ack_error_retains_or_deletes_exact_bytes_without_recount(context, monkeypatch, completed, reply_lost):
    server, connection = context
    if completed:
        for c in ('B', 'C'):
            assert server.receive_client_update(c, envelope(server))['success']
    data = envelope(server)
    key = queue(connection, 'A', data)
    native = server.redis.eval
    def failed_ack(script, *args, **kwargs):
        if script == ACKNOWLEDGE:
            if reply_lost:
                native(script, *args, **kwargs)
            raise redis.ConnectionError('controlled native acknowledgement failure')
        return native(script, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'eval', failed_ack)
        assert server.drain_pending_client_updates() == 1
    receipt = connection.get(SNAPSHOT_KEY)
    assert server.round_completed is completed
    assert (connection.get(key) is None) is reply_lost
    assert server.drain_pending_client_updates() == 0
    assert connection.get(key) is None
    assert connection.get(SNAPSHOT_KEY) == receipt


def test_same_client_current_round_duplicate_is_acknowledged(context):
    server, connection = context
    data = envelope(server)
    assert server.receive_client_update('A', data)['success']
    key = queue(connection, 'A', data)
    receipt = connection.get(SNAPSHOT_KEY)
    assert server.drain_pending_client_updates() == 0
    assert connection.get(key) is None
    assert connection.get(SNAPSHOT_KEY) == receipt


@pytest.mark.parametrize('completed', [False, True])
@pytest.mark.parametrize('lost_reply', [False, True])
def test_exact_ack_preserves_replacement_envelope(context, monkeypatch, completed, lost_reply):
    server, connection = context
    if completed:
        for c in ('B', 'C'):
            assert server.receive_client_update(c, envelope(server))['success']
    original = envelope(server)
    replacement = envelope(server, round_id=2)
    key = queue(connection, 'A', original)
    native = server.redis.eval
    def replace_before_ack(script, *args, **kwargs):
        if script == ACKNOWLEDGE:
            connection.setex(key, 123, replacement)
            result = native(script, *args, **kwargs)
            if lost_reply:
                raise redis.ConnectionError('controlled lost ack response after replacement')
            return result
        return native(script, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'eval', replace_before_ack)
        assert server.drain_pending_client_updates() == 1
    assert connection.get(key) == replacement and 0 < connection.ttl(key) <= 123
    assert server.drain_pending_client_updates() == 0
    assert connection.get(key) == replacement


def test_unselected_and_malformed_notification_ids_cannot_read_inbox(context, monkeypatch):
    server, connection = context
    key = queue(connection, 'outsider', envelope(server))
    native = server.redis.get
    reads = []
    def track_read(name, *args, **kwargs):
        reads.append(name)
        return native(name, *args, **kwargs)
    monkeypatch.setattr(server.redis, 'get', track_read)
    for client in (None, True, 7, [], {}, 'outsider'):
        assert not server._consume_pending_update(client)
    assert reads == [] and connection.get(key)


def test_actual_pubsub_and_polling_share_one_native_admission(context):
    server, connection = context
    server.start_update_consumer()
    key = queue(connection, 'A', envelope(server))
    connection.publish('federated:updates', json.dumps({'type': 'client_update', 'client_id': 'A', 'round': 1}))
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(server.drain_pending_client_updates)
        assert future.result(timeout=5) in (0, 1)
    wait_until(lambda: connection.get(key) is None)
    assert server.accepted_updates == {('A', 1)} and set(server.client_weights) == {'A'}


def test_actual_pubsub_retains_rejected_then_polling_admits_replacement(context, monkeypatch):
    server, connection = context
    server.start_update_consumer()
    observed = Event()
    native = server.redis.get
    key = queue(connection, 'A', b'invalid-token')
    def observed_get(name, *args, **kwargs):
        result = native(name, *args, **kwargs)
        if name == key:
            observed.set()
        return result
    monkeypatch.setattr(server.redis, 'get', observed_get)
    connection.publish('federated:updates', json.dumps({'type': 'client_update', 'client_id': 'A'}))
    assert observed.wait(5)
    # The GET event occurs inside the native callback's round owner. Acquiring
    # that owner waits for admission to finish before checking its outcome.
    with server._round_lock:
        assert connection.get(key) == b'invalid-token' and not server.accepted_updates
    queue(connection, 'A', envelope(server))
    assert server.drain_pending_client_updates() == 1
    assert connection.get(key) is None


def test_round_start_waits_until_read_admission_and_ack_finish(context, monkeypatch):
    server, connection = context
    data = envelope(server)
    key = queue(connection, 'A', data)
    entered, release, starting = Event(), Event(), Event()
    native = server.redis.get
    def paused_read(name, *args, **kwargs):
        value = native(name, *args, **kwargs)
        if name == key:
            entered.set()
            assert release.wait(5)
        return value
    monkeypatch.setattr(server.redis, 'get', paused_read)
    def start():
        starting.set()
        return server.start_round()
    with ThreadPoolExecutor(max_workers=2) as pool:
        delivery = pool.submit(server.drain_pending_client_updates)
        assert entered.wait(5)
        next_round = pool.submit(start)
        assert starting.wait(5)
        try:
            assert not next_round.done() and server.round == 1
        finally:
            release.set()
        assert delivery.result(timeout=5) == 1
        assert next_round.result(timeout=5)['round'] == 2
    assert connection.get(key) is None and server.round == 2


def test_uncertain_native_receipt_retains_inbox_until_confirmed_retry(context, monkeypatch):
    server, connection = context
    data = envelope(server)
    key = queue(connection, 'A', data)
    native_eval, native_get = server.redis.eval, server.redis.get
    written = Event()
    def lost_commit(script, *args, **kwargs):
        result = native_eval(script, *args, **kwargs)
        if script != ACKNOWLEDGE:
            written.set()
            raise redis.ConnectionError('controlled lost native snapshot response')
        return result
    def lost_readback(name, *args, **kwargs):
        if name == SNAPSHOT_KEY and written.is_set():
            raise redis.ConnectionError('controlled unavailable receipt readback')
        return native_get(name, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'eval', lost_commit)
        scoped.setattr(server.redis, 'get', lost_readback)
        assert server.drain_pending_client_updates() == 0
        assert server._snapshot_uncertain and not server.client_weights
    receipt = connection.get(SNAPSHOT_KEY)
    assert connection.get(key) == data
    assert server.drain_pending_client_updates() == 0
    assert not server._snapshot_uncertain and server.accepted_updates == {('A', 1)}
    assert connection.get(key) is None and connection.get(SNAPSHOT_KEY) == receipt


@pytest.mark.parametrize('reply_lost', [False, True])
def test_real_pubsub_ack_failure_recovers_through_polling(context, monkeypatch, reply_lost):
    server, connection = context
    observed = Event()
    native = server.redis.eval
    def failed_ack(script, *args, **kwargs):
        if script == ACKNOWLEDGE:
            if reply_lost:
                native(script, *args, **kwargs)
            observed.set()
            raise redis.ConnectionError('controlled native Pub/Sub ack failure')
        return native(script, *args, **kwargs)
    server.start_update_consumer()
    key = queue(connection, 'A', envelope(server))
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'eval', failed_ack)
        connection.publish('federated:updates', json.dumps({'type': 'client_update', 'client_id': 'A'}))
        assert observed.wait(5)
        with server._round_lock:
            assert server.accepted_updates == {('A', 1)}
    receipt = connection.get(SNAPSHOT_KEY)
    assert (connection.get(key) is None) is reply_lost
    assert server.drain_pending_client_updates() == 0
    assert connection.get(key) is None and connection.get(SNAPSHOT_KEY) == receipt
