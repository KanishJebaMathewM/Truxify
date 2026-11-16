"""Real TensorFlow/Keras shared graph, training and old-weight controls."""

import numpy as np
import pytest
import tensorflow as tf
from anomaly.models import LSTMAutoencoder
from tensorflow import keras
from tensorflow.keras import layers


@pytest.fixture(autouse=True)
def clear_backend():
    keras.utils.set_random_seed(31)
    yield
    keras.backend.clear_session()


def windows(dim=2, length=3):
    return tf.constant(
        np.linspace(0.1, 0.9, 2 * length * dim, dtype=np.float32).reshape(
            2, length, dim
        )
    )


def assert_composition(ae, x):
    encoded = ae.encoder(x, training=False)
    assert encoded.shape == (x.shape[0], ae.latent_dim)
    composed = ae.decoder(encoded, training=False)
    expected = ae.model(x, training=False)
    assert composed.shape == x.shape
    np.testing.assert_allclose(composed.numpy(), expected.numpy(), rtol=1e-6, atol=1e-7)


@pytest.mark.parametrize("dim,length,latent", [(1, 1, 1), (2, 3, 4), (4, 2, 7)])
def test_latent_shape_and_composition(dim, length, latent):
    ae = LSTMAutoencoder(dim, length, latent)
    ae.build_model()
    assert_composition(ae, windows(dim, length))
    encoder_vars = {id(v) for v in ae.encoder.weights}
    decoder_vars = {id(v) for v in ae.decoder.weights}
    assert encoder_vars.isdisjoint(decoder_vars)
    assert encoder_vars | decoder_vars == {id(v) for v in ae.model.weights}
    # Check actual layer identity too; parameter-free dropout is shared.
    decoder_layers = [
        l for l in ae.decoder.layers if not isinstance(l, layers.InputLayer)
    ]
    assert all(
        any(l is candidate for candidate in ae.model.layers) for l in decoder_layers
    )


def test_native_optimizer_updates_both_views():
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    x = windows()
    before_encoder = [v.numpy().copy() for v in ae.encoder.trainable_weights]
    before_decoder = [v.numpy().copy() for v in ae.decoder.trainable_weights]
    for _ in range(2):
        loss = ae.model.train_on_batch(x, x)
        assert np.isfinite(loss)
    assert int(ae.model.optimizer.iterations.numpy()) == 2
    assert any(
        not np.array_equal(a, b.numpy())
        for a, b in zip(before_encoder, ae.encoder.trainable_weights)
    )
    assert any(
        not np.array_equal(a, b.numpy())
        for a, b in zip(before_decoder, ae.decoder.trainable_weights)
    )
    assert_composition(ae, x)


def legacy_flat_model(dim, length, latent):
    # Independent original end-to-end architecture, not the broken standalone
    # views. This matches pre-fix weighted-layer order and shapes.
    inputs = layers.Input(shape=(length, dim))
    x = layers.LSTM(64, return_sequences=True, activation="relu")(inputs)
    x = layers.Dropout(0.2)(x)
    x = layers.LSTM(32, return_sequences=True, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    x = layers.LSTM(latent, activation="relu")(x)
    x = layers.RepeatVector(length)(x)
    x = layers.LSTM(32, return_sequences=True, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    x = layers.LSTM(64, return_sequences=True, activation="relu")(x)
    x = layers.Dropout(0.2)(x)
    x = layers.TimeDistributed(layers.Dense(dim))(x)
    model = keras.Model(inputs, x)
    model.compile(optimizer=keras.optimizers.Adam(0.001), loss="mse")
    return model


def test_trained_legacy_hdf5_weights_load_into_both_views(tmp_path):
    old = legacy_flat_model(2, 3, 4)
    x = windows()
    old.train_on_batch(x, x)
    old.save(tmp_path / "legacy.h5")
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    assert [tuple(w.shape) for w in old.weights] == [
        tuple(w.shape) for w in ae.model.weights
    ]
    ae.model.load_weights(tmp_path / "legacy.h5")
    np.testing.assert_allclose(
        ae.model(x, training=False), old(x, training=False), rtol=1e-6, atol=1e-7
    )
    assert_composition(ae, x)


def test_existing_save_load_preserves_shared_trained_views(tmp_path):
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    x = windows()
    ae.model.train_on_batch(x, x)
    ae.threshold = 0.25
    expected = ae.model(x, training=False).numpy()
    path = str(tmp_path / "existing")
    ae.save(path)
    restored = LSTMAutoencoder(1, 1, 1)
    restored.load(path)
    assert restored.threshold == 0.25
    np.testing.assert_allclose(
        restored.model(x, training=False), expected, rtol=1e-6, atol=1e-7
    )
    assert_composition(restored, x)


def test_successful_rebuild_invalidates_calibration_and_old_views():
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    old_model, old_encoder, old_decoder = ae.model, ae.encoder, ae.decoder
    ae.threshold = 0.2
    ae._observation_buffer["x"] = [1]
    ae.build_model()
    assert ae.threshold is None and not ae._observation_buffer
    assert (
        ae.model is not old_model
        and ae.encoder is not old_encoder
        and ae.decoder is not old_decoder
    )
    assert_composition(ae, windows())


@pytest.mark.parametrize("field", ["input_dim", "sequence_length", "latent_dim"])
@pytest.mark.parametrize("invalid", [0, -1, True, 1.5, np.nan, "2"])
def test_invalid_configuration_preserves_previous_views(field, invalid):
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    ae.threshold = 0.2
    prior = (ae.model, ae.encoder, ae.decoder)
    setattr(ae, field, invalid)
    with pytest.raises(ValueError):
        ae.build_model()
    assert (ae.model, ae.encoder, ae.decoder) == prior
    assert ae.threshold == 0.2


def test_view_weight_assignment_changes_full_model_immediately():
    ae = LSTMAutoencoder(2, 3, 4)
    ae.build_model()
    x = windows()
    output_layer = ae.decoder.layers[-1]
    kernel, bias = output_layer.get_weights()
    output_layer.set_weights([np.zeros_like(kernel), np.full_like(bias, 2.0)])
    np.testing.assert_allclose(ae.model(x, training=False), 2.0)
    assert_composition(ae, x)
