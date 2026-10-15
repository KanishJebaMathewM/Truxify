"""Real Redis listener lifetime, plus actual native client/server integration."""

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest
import redis
from cryptography.fernet import Fernet
from federated.federated_client import FederatedClient
from federated.federated_server import FederatedServer
from federated.subscription_owner import SubscriptionOwner


def eventually(check):
    for _ in range(300):
        if check():
            return
        time.sleep(0.01)
    raise AssertionError('native listener condition did not complete')


@pytest.fixture
def store():
    executable = os.environ.get('REDIS_SERVER') or shutil.which('redis-server')
    assert executable
    with tempfile.TemporaryDirectory(prefix='fsub-') as directory:
        socket = str(Path(directory) / 'redis.sock')
        process = subprocess.Popen(
            [executable, '--port', '0', '--unixsocket', socket, '--save', '',
             '--appendonly', 'no'], stdout=subprocess.DEVNULL,
        )
        client = redis.Redis(unix_socket_path=socket, socket_timeout=2)
        try:
            def ready():
                try:
                    return client.ping()
                except redis.ConnectionError:
                    return False
            eventually(ready)
            yield client
        finally:
            client.close()
            process.terminate()
            process.wait(5)


def subscribers(store):
    return store.pubsub_numsub('federated:updates')[0][1]


def test_concurrent_starts_one_native_subscriber_and_stop_closes_reader(store):
    owner = SubscriptionOwner()
    received = []
    try:
        with ThreadPoolExecutor(max_workers=12) as pool:
            assert all(pool.map(
                lambda _: owner.start(store, 'federated:updates', received.append),
                range(40),
            ))
        eventually(lambda: subscribers(store) == 1)
        worker = owner.thread
        store.publish('federated:updates', 'native')
        eventually(lambda: any(m['type'] == 'message' for m in received))
        assert owner.stop()
        assert not worker.is_alive() and owner.thread is None
        assert subscribers(store) == 0
        assert owner.stop()
    finally:
        assert owner.stop(3)


def test_timeout_retains_admitted_native_worker_and_blocks_replacement(store):
    owner = SubscriptionOwner()
    entered, release = threading.Event(), threading.Event()
    calls = []

    def callback(message):
        if message['type'] == 'message':
            entered.set()
            assert release.wait(5)
            calls.append(message['data'])

    try:
        assert owner.start(store, 'federated:updates', callback)
        old_thread, old_pubsub = owner.thread, owner.pubsub
        old_handler = old_pubsub.channels[b'federated:updates']
        store.publish('federated:updates', 'first')
        assert entered.wait(2)
        assert not owner.stop(0.01)
        assert owner.thread is old_thread and old_thread.is_alive()
        assert owner.pubsub is old_pubsub and subscribers(store) == 1
        assert not owner.start(store, 'federated:updates', callback)
        old_handler({'type': 'message', 'data': b'retired'})
        release.set()
        assert owner.stop(3)
        assert calls == [b'first']
        assert owner.start(store, 'federated:updates', calls.append)
        old_handler({'type': 'message', 'data': b'stale-generation'})
        assert calls == [b'first']
        eventually(lambda: subscribers(store) == 1)
    finally:
        release.set()
        assert owner.stop(3)


def test_callback_self_stop_retains_owner_until_native_exit(store):
    owner, outcomes = SubscriptionOwner(), []

    def callback(message):
        if message['type'] == 'message':
            outcomes.append(owner.stop())

    try:
        assert owner.start(store, 'federated:updates', callback)
        worker = owner.thread
        store.publish('federated:updates', 'stop')
        eventually(lambda: bool(outcomes))
        assert outcomes == [False]
        worker.join(3)
        assert not worker.is_alive()
        assert owner.stop()
    finally:
        assert owner.stop(3)


def test_native_acl_subscribe_failure_does_not_leak_and_can_retry(store):
    store.execute_command('ACL', 'SETUSER', 'limited', 'on', '>private-test',
                          '~*', '&*', '+ping')
    options = dict(store.connection_pool.connection_kwargs)
    options.update(username='limited', password='private-test')
    restricted = redis.Redis(connection_pool=redis.ConnectionPool(
        connection_class=redis.UnixDomainSocketConnection, **options
    ))
    owner = SubscriptionOwner()
    try:
        # redis-py sends SUBSCRIBE before reading its reply; either startup or
        # the actual reader detects the real ACL denial. Both must release it.
        try:
            owner.start(restricted, 'federated:updates', lambda _: None)
        except redis.ResponseError:
            pass
        if owner.thread is not None:
            eventually(lambda: not owner.thread.is_alive())
        assert owner.stop() and subscribers(store) == 0
        assert owner.start(store, 'federated:updates', lambda _: None)
        eventually(lambda: subscribers(store) == 1)
    finally:
        assert owner.stop(3)
        restricted.close()


@pytest.mark.parametrize('timeout', [True, None, '1', -1, float('nan'), float('inf'), 31])
def test_invalid_stop_budget_is_rejected_before_retirement(timeout):
    owner = SubscriptionOwner()
    with pytest.raises((ValueError, TypeError)):
        owner.stop(timeout)
    assert owner.thread is None


@pytest.mark.parametrize('kind', ['client', 'server'])
def test_actual_model_instance_owns_repeated_start_stop_and_restart(store, kind):
    store.set('federated:encryption_key', Fernet.generate_key())
    if kind == 'client':
        instance = FederatedClient('native-client', store)
        start, stop = instance._subscribe_updates, instance.stop_subscription
    else:
        instance = FederatedServer(redis_url='unix://' + store.connection_pool.connection_kwargs['path'])
        start, stop = instance.start_update_consumer, instance.stop_update_consumer
    try:
        with ThreadPoolExecutor(max_workers=8) as pool:
            assert all(pool.map(lambda _: start(), range(16)))
        eventually(lambda: subscribers(store) == 1)
        worker = instance._subscription.thread
        assert stop(3) and not worker.is_alive()
        assert instance.pubsub is None
        assert subscribers(store) == 0
        assert start() and subscribers(store) == 1
        # The native channel remains usable; irrelevant messages do not mutate models.
        store.publish('federated:updates', json.dumps({'type': 'unrelated'}))
    finally:
        assert stop(3)


def test_post_subscribe_failure_releases_actual_connection(store, monkeypatch):
    owner = SubscriptionOwner()
    factory = store.pubsub

    def failed_subscription():
        pubsub = factory()
        subscribe = pubsub.subscribe

        def fail(**channels):
            subscribe(**channels)
            raise RuntimeError('controlled failure after native subscription write')

        monkeypatch.setattr(pubsub, 'subscribe', fail)
        return pubsub

    with monkeypatch.context() as patch:
        patch.setattr(store, 'pubsub', failed_subscription)
        with pytest.raises(RuntimeError, match='after native subscription'):
            owner.start(store, 'federated:updates', lambda _: None)
    assert owner.thread is None and owner.pubsub is None
    eventually(lambda: subscribers(store) == 0)
    try:
        assert owner.start(store, 'federated:updates', lambda _: None)
        eventually(lambda: subscribers(store) == 1)
    finally:
        assert owner.stop(3)


def test_stop_budget_waits_for_callback_without_closing_its_connection(store):
    owner = SubscriptionOwner()
    entered, release = threading.Event(), threading.Event()

    def callback(message):
        if message['type'] == 'message':
            entered.set()
            assert release.wait(5)
            # Real commands still work while this owned callback is draining.
            assert store.ping()

    try:
        assert owner.start(store, 'federated:updates', callback)
        store.publish('federated:updates', 'drain')
        assert entered.wait(2)
        worker = owner.thread
        with ThreadPoolExecutor(max_workers=1) as pool:
            stopped = pool.submit(owner.stop, 3)
            eventually(lambda: worker.retired.is_set())
            assert not stopped.done() and worker.is_alive()
            release.set()
            assert stopped.result(4)
        assert not worker.is_alive() and owner.pubsub is None
    finally:
        release.set()
        assert owner.stop(3)
