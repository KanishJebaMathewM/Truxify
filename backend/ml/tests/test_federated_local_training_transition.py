"""Actual Keras objective/Adam/fit recovery plus existing round consumers."""
from threading import RLock

import numpy as np
import pytest
import tensorflow as tf
from federated.federated_client import FederatedClient
from tensorflow import keras


@pytest.fixture
def client():
    keras.backend.clear_session()
    c = FederatedClient.__new__(FederatedClient)
    c.client_id = 'native-fit-evidence'
    c._round_lock = RLock()
    c.model = c._create_model()
    c.training_round = c._accepted_round = 7
    c._round_model = [w.copy() for w in c.model.get_weights()]
    c._trained_round = c._published_round = c._training_result = None
    c.local_data = None
    return c


def data():
    return np.arange(40, dtype=np.float32).reshape(4, 10) / 40, np.array([0., 1., .25, .75], dtype=np.float32)


def state(c):
    variables = list(c.model.weights) + list(c.model.optimizer.variables)
    for metric in c.model.metrics: variables.extend(metric.variables)
    return [(v, v.numpy().copy()) for v in variables]


def unchanged(before):
    for variable, value in before:
        np.testing.assert_array_equal(variable.numpy(), value)


@pytest.mark.parametrize('kind', ['nan-tail', 'inf-tail', 'overflow-cast', 'wrong-width', 'row-mismatch',
                                 'bool-data', 'string-data', 'nan-label', 'negative-label', 'large-label',
                                 'empty', 'zero-epochs', 'fractional-epochs', 'bool-epochs', 'epoch-budget',
                                 'row-budget', 'work-budget'])
def test_complete_admission_precedes_fit_optimizer_and_record_mutation(client, kind, monkeypatch):
    x, y, epochs = *data(), 1
    if kind == 'nan-tail': x[-1, -1] = np.nan
    elif kind == 'inf-tail': x[-1, -1] = np.inf
    elif kind == 'overflow-cast': x = x.astype(np.float64); x[-1, -1] = 1e308
    elif kind == 'wrong-width': x = x[:, :-1]
    elif kind == 'row-mismatch': y = y[:-1]
    elif kind == 'bool-data': x = x.astype(bool)
    elif kind == 'string-data': x = x.astype(str)
    elif kind == 'nan-label': y[-1] = np.nan
    elif kind == 'negative-label': y[-1] = -.1
    elif kind == 'large-label': y[-1] = 1.1
    elif kind == 'empty': x, y = x[:0], y[:0]
    elif kind == 'zero-epochs': epochs = 0
    elif kind == 'fractional-epochs': epochs = 1.5
    elif kind == 'bool-epochs': epochs = True
    elif kind == 'epoch-budget': epochs = 17
    elif kind == 'row-budget': x, y = np.zeros((4097, 10)), np.zeros(4097)
    elif kind == 'work-budget':
        # A larger actual compiled ten-feature binary topology crosses the
        # independent parameter*row*epoch plan; the default model does not.
        m = keras.Sequential([keras.layers.Input(shape=(10,)), keras.layers.Dense(128),
                              keras.layers.Dense(64), keras.layers.Dense(1, activation='sigmoid')])
        m.compile(optimizer='adam', loss='binary_crossentropy', metrics=['accuracy'])
        m.optimizer.build(m.trainable_variables)
        client.model = m
        x, y, epochs = np.zeros((4096, 10)), np.zeros(4096), 16
    before = state(client)
    monkeypatch.setattr(client.model, 'fit', lambda *a, **k: pytest.fail('invalid tuple reached native fit'))
    result = client.train_local(x, y, epochs)
    assert result['success'] is False and client.local_data is None
    assert client._trained_round is None and client._training_result is None
    unchanged(before)


@pytest.mark.parametrize('dtype', ['float32', 'float64'])
def test_independent_binary_crossentropy_and_first_native_keras_adam(client, dtype):
    previous_policy = keras.mixed_precision.global_policy()
    try:
        keras.mixed_precision.set_global_policy(dtype)
        m = keras.Sequential([keras.layers.Input(shape=(10,)), keras.layers.Dense(1, activation='sigmoid')])
    finally:
        keras.mixed_precision.set_global_policy(previous_policy)
    m.compile(optimizer=keras.optimizers.Adam(.001), loss='binary_crossentropy', metrics=['accuracy'])
    m.optimizer.build(m.trainable_variables)
    for variable in m.weights: variable.assign(np.zeros(variable.shape, dtype))
    client.model = m
    x, y = data()
    gradient = x.T @ (.5 - y)[:, None] / len(y)
    # Native Keras Adam uses epsilon before, rather than after, bias correction.
    first_m, first_v = .1 * gradient, .001 * gradient ** 2
    reference = -.001 * np.sqrt(.001) / .1 * first_m / (np.sqrt(first_v) + 1e-7)
    result = client.train_local(x, y, 1)
    assert result['success'] is True
    assert result['loss'] == pytest.approx(np.log(2), rel=1e-6)
    assert result['accuracy'] == pytest.approx(.25)
    np.testing.assert_allclose(m.weights[0].numpy(), reference, rtol=3e-5, atol=1e-8)
    assert int(m.optimizer.iterations.numpy()) == 1
    assert client._trained_round == 7
    assert client.local_data[0] is not x and client.local_data[1] is not y


def test_own_source_data_before_actual_fit_and_publish_only_success(client, monkeypatch):
    x, y = data()
    expected_x, expected_y = x.copy(), y.copy()[:, None]
    native = client.model.fit
    def mutate_source(owned_x, owned_y, **kwargs):
        x.fill(np.nan); y.fill(np.nan)
        np.testing.assert_array_equal(owned_x, expected_x)
        np.testing.assert_array_equal(owned_y, expected_y)
        return native(owned_x, owned_y, **kwargs)
    monkeypatch.setattr(client.model, 'fit', mutate_source)
    result = client.train_local(x, y, 1)
    assert result['success']
    np.testing.assert_array_equal(client.local_data[0], expected_x)
    np.testing.assert_array_equal(client.local_data[1], expected_y)
    monkeypatch.setattr(client.model, 'fit', lambda *a, **k: pytest.fail('duplicate retraining'))
    duplicate = client.train_local(x, y, 1)
    assert duplicate['success'] and duplicate['duplicate']


@pytest.mark.parametrize('kind', ['after-native-fit', 'missing-accuracy', 'nan-metric', 'invalid-accuracy'])
def test_rejected_actual_fit_recovers_registered_state_and_retry(client, kind, monkeypatch):
    x, y = data()
    native = client.model.fit
    before = state(client)
    ids = [id(v) for v in client.model.weights] + [id(v) for v in client.model.optimizer.variables]
    def fail(*args, **kwargs):
        history = native(*args, **kwargs)
        if kind == 'after-native-fit': raise RuntimeError('native fit completed before injected failure')
        if kind == 'missing-accuracy': history.history.pop('accuracy')
        elif kind == 'nan-metric': history.history['loss'][-1] = np.nan
        else: history.history['accuracy'][-1] = 1.1
        return history
    monkeypatch.setattr(client.model, 'fit', fail)
    result = client.train_local(x, y, 1)
    assert not result['success'] and client._trained_round is None and client.local_data is None
    unchanged(before)
    assert ids == [id(v) for v in client.model.weights] + [id(v) for v in client.model.optimizer.variables]
    for metric in client.model.metrics:
        assert all(np.all(v.numpy() == 0) for v in metric.variables)
    monkeypatch.setattr(client.model, 'fit', native)
    retry = client.train_local(x, y, 1)
    assert retry['success'] and client._trained_round == 7
    assert int(client.model.optimizer.iterations.numpy()) == 1


def test_finite_policy_product_native_adam_failure_recovers_complete_state(client):
    x, y = data()
    client.model.optimizer.learning_rate.assign(1e38)
    client.model.optimizer.weight_decay = 1e38
    before = state(client)
    result = client.train_local(x, y, 1)
    assert not result['success'] and client.local_data is None and client._trained_round is None
    unchanged(before)
    assert int(client.model.optimizer.iterations.numpy()) == 0
    client.model.optimizer.learning_rate.assign(.001)
    client.model.optimizer.weight_decay = None
    assert client.train_local(x, y, 1)['success']


def test_admitted_finite_observation_native_failure_never_publishes_poison(client):
    for variable in client.model.weights: variable.assign(np.full(variable.shape, .05, np.float32))
    before = state(client)
    x = np.full((4, 10), 1e38, np.float32)
    result = client.train_local(x, np.array([0., 1., 0., 1.], np.float32), 1)
    assert not result['success'] and client._training_result is None
    unchanged(before)
    assert client._accepted_round == client.training_round == 7
    assert client._trained_round is None


@pytest.mark.parametrize('field,value', [('learning_rate', np.nan), ('weight_decay', np.inf), ('beta_1', 1.), ('epsilon', 0.)])
def test_invalid_native_adam_policy_rejected_before_fitting(client, field, value, monkeypatch):
    if field == 'learning_rate': client.model.optimizer.learning_rate.assign(value)
    else: setattr(client.model.optimizer, field, value)
    monkeypatch.setattr(client.model, 'fit', lambda *a, **k: pytest.fail('bad Adam policy reached native fit'))
    assert not client.train_local(*data(), 1)['success']
    assert int(client.model.optimizer.iterations.numpy()) == 0


def test_nonfinite_registered_model_rejected_without_retraining(client, monkeypatch):
    client.model.weights[0].assign(np.full(client.model.weights[0].shape, np.nan, np.float32))
    monkeypatch.setattr(client.model, 'fit', lambda *a, **k: pytest.fail('nonfinite native model reached fit'))
    assert not client.train_local(*data(), 1)['success']
    assert int(client.model.optimizer.iterations.numpy()) == 0


assert tf.__version__
