"""Complete aligned native recommendation candidates and input ownership."""

import numpy as np

MAX_IDS = 10_000
MAX_ID_LENGTH = 256
MAX_CELLS = 2_000_000


def _ids(value, name):
    if not isinstance(value, (list, tuple)) or len(value) > MAX_IDS:
        raise ValueError(f'{name} must be a bounded ID collection')
    owned = list(value)
    if any(not isinstance(item, str) or not 1 <= len(item) <= MAX_ID_LENGTH for item in owned):
        raise ValueError(f'{name} must contain nonempty bounded strings')
    if len(set(owned)) != len(owned):
        raise ValueError(f'{name} must contain unique IDs')
    return owned


def _matrix(value, shape, name, ratings=False):
    if (not isinstance(value, np.ndarray) or value.shape != shape
            or value.dtype.kind not in 'iuf' or not np.isfinite(value).all()):
        raise ValueError(f'{name} must be a finite real matrix with aligned geometry')
    with np.errstate(over='ignore', invalid='ignore'):
        owned = np.array(value, dtype=np.float64, copy=True)
    if not np.isfinite(owned).all():
        raise ValueError(f'{name} is not representable in native float64')
    if ratings and not ((owned >= 0) & (owned <= 5)).all():
        raise ValueError(f'{name} must contain missing zeros or ratings in (0, 5]')
    owned.setflags(write=False)
    return owned


def own_training_inputs(payload):
    if not isinstance(payload, dict):
        raise TypeError('collaborative payload must be a dictionary')
    names = ('user_ids', 'load_ids', 'truck_ids', 'user_load_matrix', 'user_truck_matrix')
    if not set(names) <= payload.keys():
        raise KeyError(next(name for name in names if name not in payload))
    result = {name: _ids(payload[name], name) for name in names[:3]}
    rows = len(result['user_ids'])
    if rows * (len(result['load_ids']) + len(result['truck_ids'])) > MAX_CELLS:
        raise ValueError('collaborative matrices exceed the dense cell budget')
    for kind in ('load', 'truck'):
        name = f'user_{kind}_matrix'
        result[name] = _matrix(payload[name], (rows, len(result[f'{kind}_ids'])), name, ratings=True)
    return result


def own_candidate(payload):
    result = own_training_inputs(payload)
    rows = len(result['user_ids'])
    for kind in ('load', 'truck'):
        score, popularity = f'user_{kind}_approx', f'popular_{kind}s'
        if score not in payload or popularity not in payload:
            raise KeyError(score if score not in payload else popularity)
        columns = len(result[f'{kind}_ids'])
        result[score] = _matrix(payload[score], (rows, columns), score)
        order = payload[popularity]
        if (not isinstance(order, np.ndarray) or order.dtype.kind not in 'iu'
                or order.shape != (columns,)):
            raise ValueError(f'{popularity} must be a complete aligned index permutation')
        # Preserve native tie ordering, while disallowing an order that claims
        # a less popular item precedes a strictly more popular one.
        owned = np.array(order, dtype=np.int64, copy=True)
        if not np.array_equal(np.sort(owned), np.arange(columns)):
            raise ValueError(f'{popularity} must be a complete aligned index permutation')
        totals = result[f'user_{kind}_matrix'].sum(axis=0)[owned]
        if np.any(totals[:-1] < totals[1:]):
            raise ValueError(f'{popularity} must follow descending observed popularity')
        owned.setflags(write=False)
        result[popularity] = owned
    return result
