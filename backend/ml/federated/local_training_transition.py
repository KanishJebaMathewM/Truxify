"""Owned binary observations and whole-fit native Keras publication boundary."""
import math
from numbers import Integral, Real

import numpy as np
from tensorflow import keras

MAX_ROWS = 4096
MAX_EPOCHS = 16
MAX_WORK = 256_000_000


def owned_batch(model, data, labels, epochs):
    if isinstance(epochs, (bool, np.bool_)) or not isinstance(epochs, Integral) or not 1 <= epochs <= MAX_EPOCHS:
        raise ValueError("epochs must be an integer in [1,16]")
    if model.input_shape != (None, 10) or model.output_shape != (None, 1):
        raise ValueError("local training requires the declared ten-feature binary model")
    raw, targets = np.asarray(data), np.asarray(labels)
    if (raw.ndim != 2 or raw.shape[1] != 10 or not 1 <= len(raw) <= MAX_ROWS
            or targets.shape not in ((len(raw),), (len(raw), 1))
            or raw.dtype.kind not in 'iuf' or targets.dtype.kind not in 'iuf'):
        raise ValueError("local training requires complete nonempty real paired binary observations")
    if len(raw) * int(epochs) * model.count_params() > MAX_WORK:
        raise ValueError("complete local fit exceeds work budget")
    dtype = np.dtype(model.compute_dtype)
    if dtype not in (np.dtype('float32'), np.dtype('float64')):
        raise ValueError("local training supports native float32/float64")
    with np.errstate(over='ignore', invalid='ignore'):
        x = np.array(raw, dtype=dtype, copy=True)
        y = np.array(targets, dtype=dtype, copy=True).reshape(-1, 1)
    if not np.isfinite(x).all() or not np.isfinite(y).all() or np.any((y < 0) | (y > 1)):
        raise ValueError("features must be finite and binary soft labels must lie in [0,1]")
    return x, y, int(epochs)


def _variables(model):
    variables, seen = [], set()
    candidates = list(model.weights) + list(model.optimizer.variables)
    for metric in model.metrics:
        candidates.extend(metric.variables)
    for variable in candidates:
        if id(variable) not in seen:
            seen.add(id(variable))
            variables.append(variable)
    return variables


def admit_native(model):
    optimizer = model.optimizer
    if type(optimizer) is not keras.optimizers.Adam or not optimizer.built:
        raise ValueError("local training requires its built native Adam optimizer")
    if model.loss != 'binary_crossentropy':
        raise ValueError("local training requires the compiled binary crossentropy objective")
    config = optimizer.get_config()
    values = {'learning_rate': float(np.asarray(optimizer.learning_rate.numpy()))}
    values.update({name: config.get(name) for name in ('beta_1', 'beta_2', 'epsilon', 'weight_decay', 'clipnorm', 'global_clipnorm', 'clipvalue')})
    for name, value in values.items():
        if value is None and name not in ('learning_rate', 'beta_1', 'beta_2', 'epsilon'):
            continue
        if isinstance(value, bool) or not isinstance(value, Real) or not math.isfinite(value) or value < 0:
            raise ValueError("Adam policy must contain finite nonnegative native scalars")
        if name in ('beta_1', 'beta_2') and value >= 1 or name == 'epsilon' and value <= 0:
            raise ValueError("Adam betas must lie in [0,1) and epsilon must be positive")
    if any(not np.isfinite(variable.numpy()).all() for variable in _variables(model)):
        raise ValueError("native model, Adam and metrics must be finite")


def observed_metrics(history, epochs):
    values = getattr(history, 'history', None)
    if not isinstance(values, dict):
        raise ValueError("fit must return actual observed metric history")  # noqa: TRY004 - uniform admission
    result = {}
    for name in ('loss', 'accuracy'):
        series = values.get(name)
        if not isinstance(series, (list, tuple)) or len(series) != epochs:
            raise ValueError("fit history must report loss/accuracy for every requested epoch")
        for value in series:
            if isinstance(value, (bool, np.bool_)) or not isinstance(value, Real) or not math.isfinite(value):
                raise ValueError("fit metric observations must be finite real scalars")
            if value < 0 or name == 'accuracy' and value > 1:
                raise ValueError("fit metric observations are outside their domain")
        result[name] = float(series[-1])
    return result


def fit_candidate(model, data, labels, epochs):
    """Restore ordinary failed fits; caller owns the surrounding round lock."""
    x, y, epochs = owned_batch(model, data, labels, epochs)
    admit_native(model)
    before = [(variable, variable.numpy().copy()) for variable in _variables(model)]
    try:
        history = model.fit(x, y, epochs=epochs, batch_size=32, verbose=0)
        admit_native(model)
        metrics = observed_metrics(history, epochs)
    except Exception:
        for variable, value in before:
            variable.assign(value)
        # Keras may lazily create accuracy counters on its first actual fit.
        # Keep newly registered metric counters at their initial zero value.
        known = {id(variable) for variable, _value in before}
        for metric in model.metrics:
            for variable in metric.variables:
                if id(variable) not in known:
                    variable.assign(np.zeros(variable.shape, dtype=variable.dtype))
        raise
    return metrics, (x, y)
