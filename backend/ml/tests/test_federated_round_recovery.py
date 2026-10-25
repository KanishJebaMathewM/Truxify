"""Real Keras/Fernet/Redis coordinator restart and confirmed-receipt failures."""
import json

import numpy as np
import pytest
import redis
import tensorflow as tf
from federated.federated_server import FederatedServer
from federated.round_recovery import (
    MAX_SNAPSHOT_BYTES,
    SNAPSHOT_KEY,
    RoundRecoveryError,
    SnapshotWriteError,
    commit,
    record,
)
from test_federated_model_admission import native_redis as _native_redis_fixture

native_redis = _native_redis_fixture


@pytest.fixture
def context(native_redis, tmp_path, monkeypatch):
    connection, url = native_redis
    connection.flushdb()
    connection.sadd('federated:clients', 'A', 'B')
    monkeypatch.delenv('FEDERATED_ENCRYPTION_KEY', raising=False)
    monkeypatch.chdir(tmp_path)
    instances = []
    def create(noise_override=0.0):
        server = FederatedServer(url, min_clients=2, clients_per_round=2)
        if noise_override is not None:
            server.dp_noise_scale = noise_override
        # Only unrelated background delivery is excluded; state/store/math are native.
        monkeypatch.setattr(server, 'start_update_consumer', lambda: None)
        instances.append(server)
        return server
    server = create()
    server.start_round()
    yield server, connection, create
    for instance in instances:
        instance.stop_update_consumer()
        instance.redis.close()


def envelope(server, weights):
    return server.cipher.encrypt(json.dumps({'round': server.round,
                                'weights': [w.tolist() for w in weights]}).encode())


def equal(actual, expected):
    for left, right in zip(actual, expected):
        np.testing.assert_array_equal(left, right)
    assert len(actual) == len(expected)


def proposal(server):
    return [w + np.float32(.002) for w in server.model.get_weights()]


def test_restart_after_one_ack_recovers_native_contribution_and_completes(context):
    server, connection, create = context
    target = proposal(server)
    before = server.model.get_weights()
    assert server.receive_client_update('A', envelope(server, target))['success']
    restarted = create()
    assert restarted.accepted_updates == {('A', 1)}
    equal(restarted.client_weights['A'], target)
    equal(restarted.model.get_weights(), before)
    receipt = connection.get(SNAPSHOT_KEY)
    assert restarted.receive_client_update('A', envelope(restarted, target))['duplicate']
    assert connection.get(SNAPSHOT_KEY) == receipt
    result = restarted.receive_client_update('B', envelope(restarted, target))
    assert result['success'] and result['clients_aggregated'] == 2
    equal(restarted.model.get_weights(), target)
    assert restarted.round_completed and not restarted.client_weights
    final = create()
    equal(final.model.get_weights(), target)
    equal(final.get_global_model(), target)
    assert final.round_completed and final.completed_rounds == {1}
    assert not final._aggregate_weights()


def test_restored_native_prediction_matches_confirmed_model(context):
    server, _, create = context
    target = proposal(server)
    for client in ('A', 'B'):
        assert server.receive_client_update(client, envelope(server, target))['success']
    inputs = tf.constant(np.arange(30).reshape(3, 10) / 30, dtype=tf.float32)
    expected = server.model(inputs, training=False).numpy()
    actual = create().model(inputs, training=False).numpy()
    np.testing.assert_array_equal(actual, expected)


def test_native_acl_write_failure_preserves_confirmed_state_and_allows_retry(context):
    server, connection, _ = context
    before = server.model
    weights = before.get_weights()
    receipt = connection.get(SNAPSHOT_KEY)
    connection.execute_command('ACL', 'SETUSER', 'snapshot-readonly', 'reset', 'on',
                               'nopass', '~*', '+get')
    restricted = redis.Redis(unix_socket_path=connection.connection_pool.connection_kwargs['path'],
                             username='snapshot-readonly')
    original = server.redis
    try:
        server.redis = restricted
        result = server.receive_client_update('A', envelope(server, proposal(server)))
        assert not result['success'] and result['retryable']
        assert server.model is before and not server.client_weights and not server.accepted_updates
        equal(server.model.get_weights(), weights)
        assert connection.get(SNAPSHOT_KEY) == receipt
    finally:
        server.redis = original
        restricted.close()
    assert server.receive_client_update('A', envelope(server, proposal(server)))['success']


def test_native_commit_with_lost_reply_is_confirmed_once(context, monkeypatch):
    server, connection, create = context
    native = server.redis.eval
    def reply_lost(*args, **kwargs):
        native(*args, **kwargs)
        raise redis.ConnectionError('controlled response loss after native EVAL')
    monkeypatch.setattr(server.redis, 'eval', reply_lost)
    target = proposal(server)
    result = server.receive_client_update('A', envelope(server, target))
    assert result['success'] and not server._snapshot_uncertain
    restored = create()
    assert restored.accepted_updates == {('A', 1)}
    equal(restored.client_weights['A'], target)
    assert restored.receive_client_update('A', envelope(restored, target))['duplicate']
    assert connection.get(SNAPSHOT_KEY)


def test_reply_and_readback_loss_block_readiness_until_reconciliation(context, monkeypatch):
    server, _, create = context
    before = server.model
    weights = before.get_weights()
    target = proposal(server)
    native_eval, native_get = server.redis.eval, server.redis.get
    written = []
    def lost(*args, **kwargs):
        native_eval(*args, **kwargs)
        written.append(True)
        raise redis.ConnectionError('controlled lost commit response')
    def unreadable(key, *args, **kwargs):
        if written and key == SNAPSHOT_KEY:
            raise redis.ConnectionError('controlled unreadable commit receipt')
        return native_get(key, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'eval', lost)
        scoped.setattr(server.redis, 'get', unreadable)
        result = server.receive_client_update('A', envelope(server, target))
        assert not result['success'] and result['retryable'] and server._snapshot_uncertain
        assert server.model is before
        equal(server.model.get_weights(), weights)
        with pytest.raises(RoundRecoveryError): server.get_global_model()
    equal(server.get_global_model(), weights)
    assert server.accepted_updates == {('A', 1)} and not server._snapshot_uncertain
    equal(server.client_weights['A'], target)
    assert create().accepted_updates == {('A', 1)}


def test_stale_writer_cannot_overwrite_newer_accepted_receipt(context):
    server, connection, create = context
    stale = create()
    desired = proposal(server)
    pending = record(stale, updates={'B': desired}, accepted=['B'])
    assert server.receive_client_update('A', envelope(server, desired))['success']
    current = connection.get(SNAPSHOT_KEY)
    with pytest.raises(SnapshotWriteError): commit(stale, pending)
    assert connection.get(SNAPSHOT_KEY) == current
    assert stale.accepted_updates == {('A', 1)}
    equal(stale.client_weights['A'], desired)
    assert stale.receive_client_update('B', envelope(stale, desired))['success']
    assert stale.round_completed


@pytest.mark.parametrize('kind', ['schema', 'round_bool', 'duplicate_selection', 'oversize_selection',
                                 'unknown_accepted', 'missing_receipt', 'completed_with_buffers',
                                 'nan_global', 'wrong_shape', 'bad_update', 'extra_key', 'oversized_ciphertext'])
def test_invalid_snapshot_never_publishes_partial_native_state(context, kind):
    server, connection, create = context
    original = connection.get(SNAPSHOT_KEY)
    data = json.loads(server.cipher.decrypt(original))
    if kind == 'schema': data['schema'] = 2
    if kind == 'round_bool': data['round'] = True
    if kind == 'duplicate_selection': data['selected'] = ['A', 'A']
    if kind == 'oversize_selection': data['selected'] = [str(i) for i in range(65)]
    if kind == 'unknown_accepted': data['accepted'] = ['C']
    if kind == 'missing_receipt': data['accepted'] = ['A']
    if kind == 'completed_with_buffers':
        data.update(completed=True, accepted=['A'], updates={'A': data['global']})
    if kind == 'nan_global': data['global'][0][0][0] = float('nan')
    if kind == 'wrong_shape': data['global'][0] = [1.0]
    if kind == 'bad_update': data.update(accepted=['A'], updates={'A': []})
    if kind == 'extra_key': data['invented'] = 1
    invalid = (b'x' * (MAX_SNAPSHOT_BYTES + 1) if kind == 'oversized_ciphertext'
               else server.cipher.encrypt(json.dumps(data).encode()))
    before, weights = server.model, server.model.get_weights()
    connection.set(SNAPSHOT_KEY, invalid)
    with pytest.raises(RoundRecoveryError): server.start_round()
    assert server.model is before
    equal(server.model.get_weights(), weights)
    with pytest.raises(RoundRecoveryError): create().get_global_model()
    connection.set(SNAPSHOT_KEY, original)
    equal(server.get_global_model(), weights)


def test_legacy_identity_only_round_refused_without_deletion(context):
    server, connection, create = context
    connection.delete(SNAPSHOT_KEY)
    connection.set('federated:accepted', json.dumps([['A', 1]]))
    legacy = create()
    with pytest.raises(RoundRecoveryError): legacy.get_global_model()
    with pytest.raises(RoundRecoveryError): legacy.start_round()
    assert json.loads(connection.get('federated:accepted')) == [['A', 1]]
    assert connection.get('federated:round') == b'1'
    assert server.model is not None


def test_derived_native_checkpoint_failure_does_not_undo_confirmed_completion(context, tmp_path):
    server, _, create = context
    (tmp_path / 'models').write_text('native directory collision')
    target = proposal(server)
    assert server.receive_client_update('A', envelope(server, target))['success']
    result = server.receive_client_update('B', envelope(server, target))
    assert result['success'] and result['checkpoint_saved'] is False
    assert server.round_completed
    equal(create().model.get_weights(), target)


def test_native_round_aggregation_policy_survives_restart(context):
    server, _, create = context
    server.dp_clip_norm = .25
    server.dp_noise_scale = .07
    assert server.receive_client_update('A', envelope(server, proposal(server)))['success']
    restarted = create(noise_override=None)
    assert restarted.dp_clip_norm == .25 and restarted.dp_noise_scale == .07


def test_transient_native_read_failure_is_retryable_without_state_mutation(context, monkeypatch):
    server, _, _ = context
    before, weights = server.model, server.model.get_weights()
    native_get = server.redis.get
    def unavailable(key, *args, **kwargs):
        if key == SNAPSHOT_KEY:
            raise redis.ConnectionError('controlled native read outage')
        return native_get(key, *args, **kwargs)
    with monkeypatch.context() as scoped:
        scoped.setattr(server.redis, 'get', unavailable)
        result = server.receive_client_update('A', envelope(server, proposal(server)))
        assert not result['success'] and result['retryable']
        assert server.model is before and not server.client_weights
        equal(server.model.get_weights(), weights)
    assert server.receive_client_update('A', envelope(server, proposal(server)))['success']


def test_committed_receipt_owns_input_through_actual_native_preparation(context, monkeypatch):
    from tensorflow import keras
    server, connection, create = context
    target = proposal(server)
    data = record(server, updates={'A': target}, accepted=['A'])
    expected = [w.copy() for w in server.global_weights]
    native = keras.models.clone_model
    def mutate_after_native_clone(model):
        candidate = native(model)
        data['round'] = 2
        data['global'][0][0][0] = 100
        data['updates'].clear()
        return candidate
    with monkeypatch.context() as scoped:
        scoped.setattr(keras.models, 'clone_model', mutate_after_native_clone)
        commit(server, data)
    assert server.round == 1 and server.accepted_updates == {('A', 1)}
    equal(server.global_weights, expected)
    restored = create()
    assert restored.round == 1 and restored.accepted_updates == {('A', 1)}
    equal(restored.global_weights, expected)
    equal(restored.client_weights['A'], target)
    assert connection.get(SNAPSHOT_KEY)


def test_same_shape_different_native_architecture_is_not_silently_restored(context, monkeypatch):
    from tensorflow import keras
    server, connection, create = context
    receipt = connection.get(SNAPSHOT_KEY)
    native_create = FederatedServer._create_model
    def incompatible(self):
        model = native_create(self)
        model.layers[0].activation = keras.activations.tanh
        return model
    with monkeypatch.context() as scoped:
        scoped.setattr(FederatedServer, '_create_model', incompatible)
        with pytest.raises(RoundRecoveryError): create().get_global_model()
    assert connection.get(SNAPSHOT_KEY) == receipt
    assert server.round == 1
