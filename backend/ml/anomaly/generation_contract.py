"""Owned native anomaly training candidates; no live-state mutation during fitting."""

from numbers import Integral

import numpy as np
from sklearn.preprocessing import StandardScaler
from tensorflow import keras

from .models import LSTMAutoencoder


class AdmissionError(ValueError):
    """The caller's temporal data or requested work is unsupported."""


def finite_array(value, label):
    try:
        raw = np.asarray(value)
        if raw.dtype.kind not in "iuf" or not np.isfinite(raw).all():
            raise ValueError
        owned = np.array(raw, dtype=np.float64, copy=True)
        if not np.isfinite(owned).all():
            raise ValueError
        return owned
    except (TypeError, ValueError, OverflowError) as exc:
        raise AdmissionError(f"{label} must contain finite real numbers") from exc


def admit_training(data, models, epochs):
    if (
        isinstance(epochs, (bool, np.bool_))
        or not isinstance(epochs, Integral)
        or not 1 <= epochs <= 16
    ):
        raise AdmissionError("epochs must be an integer in [1, 16]")
    if (
        not isinstance(data, dict)
        or not data
        or any(name not in models for name in data)
    ):
        raise AdmissionError("provide a nonempty mapping of known data types")
    owned = {}
    work = 0
    for name, values in data.items():
        model = models[name]
        if not (
            1 <= model.input_dim <= 256
            and 1 <= model.sequence_length <= 512
            and 1 <= model.latent_dim <= 128
        ):
            raise AdmissionError(
                "model geometry is outside the supported training budget"
            )
        array = finite_array(values, name)
        if (
            array.ndim != 3
            or array.shape[1:] != (model.sequence_length, model.input_dim)
            or not 1 <= len(array) <= 128
        ):
            raise AdmissionError(
                f"{name} requires [1..128, {model.sequence_length}, {model.input_dim}]"
            )
        params = model.model.count_params()
        work += len(array) * model.sequence_length * params * int(epochs)
        if params > 4_000_000 or work > 512_000_000:
            raise AdmissionError(
                "estimated training work exceeds 512 million sequence-parameter visits"
            )
        owned[name] = array
    return owned


def finite_variables(variables, label):
    for value in variables:
        if not np.isfinite(value.numpy()).all():
            raise ValueError(f"{label} contains a nonfinite native variable")


def capture(model):
    if model.model.compute_dtype != "float32":
        raise ValueError("anomaly continuation supports the native float32 graph")
    optimizer = model.model.optimizer
    if type(optimizer) is not keras.optimizers.Adam:
        raise ValueError("anomaly continuation requires native Adam")
    finite_variables(model.model.weights, "model")
    finite_variables(optimizer.variables, "optimizer")
    return (
        model.input_dim,
        model.sequence_length,
        model.latent_dim,
        [np.array(w, copy=True) for w in model.model.get_weights()],
        keras.optimizers.serialize(optimizer),
        [np.array(v.numpy(), copy=True) for v in optimizer.variables]
        if optimizer.built
        else None,
    )


def prepare_candidate(snapshot, raw, epochs):
    input_dim, sequence_length, latent_dim, weights, config, state = snapshot
    scaler = StandardScaler()
    with np.errstate(over="raise", invalid="raise", divide="raise"):
        scaled = scaler.fit_transform(raw.reshape(-1, input_dim)).reshape(raw.shape)
        scaled = scaled.astype(np.float32)
    if (
        not np.isfinite(scaled).all()
        or not np.isfinite(scaler.mean_).all()
        or not np.isfinite(scaler.scale_).all()
    ):
        raise ValueError("normalization produced nonfinite values")
    candidate = LSTMAutoencoder(input_dim, sequence_length, latent_dim)
    candidate.build_model()
    candidate.model.set_weights(weights)
    optimizer = keras.optimizers.deserialize(config)
    candidate.model.compile(optimizer=optimizer, loss="mse")
    optimizer.build(candidate.model.trainable_variables)
    if state is not None:
        if len(state) != len(optimizer.variables) or any(
            a.shape != tuple(v.shape) for a, v in zip(state, optimizer.variables)
        ):
            raise ValueError("native Adam continuation schema differs")
        for variable, value in zip(optimizer.variables, state):
            variable.assign(value)
    history = candidate.train(scaled, epochs=int(epochs)).history
    if "loss" not in history or len(history["loss"]) != epochs:
        raise ValueError("native training did not report every epoch")
    for values in history.values():
        if (
            len(values) != epochs
            or not np.isfinite(np.asarray(values, dtype=float)).all()
        ):
            raise ValueError("native training history is incomplete or nonfinite")
    finite_variables(candidate.model.weights, "candidate model")
    finite_variables(optimizer.variables, "candidate optimizer")
    if (
        candidate.threshold is None
        or not np.isfinite(candidate.threshold)
        or candidate.threshold <= 0
    ):
        raise ValueError(
            "ratio scoring requires positive finite reconstruction calibration"
        )
    return (
        candidate,
        scaler,
        {
            "loss": float(history["loss"][-1]),
            "val_loss": float(history["val_loss"][-1])
            if "val_loss" in history
            else None,
        },
    )
