"""Confirmed encrypted current-round receipts; Redis survives coordinator restart."""

import copy
import json

import redis
from tensorflow import keras

from .model_updates import _parameter, admit_model_weights

SNAPSHOT_KEY = 'federated:server_snapshot:v1'
MAX_SNAPSHOT_BYTES = 16 * 1024 * 1024
MAX_CLIENTS = 64
MAX_CLIENT_ID_BYTES = 256
CAS_SCRIPT = """
local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'missing' then
    if current then return 0 end
elseif current ~= ARGV[2] then
    return 0
end
redis.call('SET', KEYS[1], ARGV[3])
return 1
"""


class RoundRecoveryError(ValueError):
    """A complete confirmed native round cannot be reconstructed."""


class SnapshotUnavailableError(RoundRecoveryError):
    """Transient native storage failure; no readiness or success is assumed."""


class SnapshotWriteError(RuntimeError):
    """No confirmed commit receipt; caller can retry without assumed success."""


class SnapshotConflict(SnapshotWriteError):
    """Another snapshot superseded this operation's expected receipt."""


def _clients(values):
    if not isinstance(values, list) or len(values) > MAX_CLIENTS:
        raise RoundRecoveryError('snapshot requires bounded selected clients')
    if any(not isinstance(value, str) or not value or len(value.encode()) > MAX_CLIENT_ID_BYTES
           for value in values) or len(set(values)) != len(values):
        raise RoundRecoveryError('snapshot client IDs must be unique bounded strings')
    return list(values)


def architecture(model):
    """Describe supported server semantics without unstable generated layer names."""
    layers = []
    for layer in model.layers:
        kind = type(layer).__name__
        entry = {'type': kind, 'dtype': layer.compute_dtype}
        if kind == 'Dense':
            entry.update(units=layer.units, use_bias=layer.use_bias,
                         activation=keras.activations.serialize(layer.activation))
        elif kind == 'Dropout':
            entry['rate'] = layer.rate
        else:
            raise RoundRecoveryError('unsupported native server architecture')
        layers.append(entry)
    return {'input_features': model.input_shape[-1], 'layers': layers}


def prepare(server, record):
    keys = {'schema', 'round', 'selected', 'accepted', 'updates', 'completed', 'global', 'policy', 'architecture'}
    if not isinstance(record, dict) or set(record) != keys or type(record['schema']) is not int or record['schema'] != 1:
        raise RoundRecoveryError('unsupported server snapshot schema')
    if type(record['round']) is not int or not 1 <= record['round'] < 2 ** 63:
        raise RoundRecoveryError('snapshot round must be a positive bounded integer')
    selected, accepted = _clients(record['selected']), _clients(record['accepted'])
    if not selected or not set(accepted) <= set(selected) or type(record['completed']) is not bool:
        raise RoundRecoveryError('snapshot round identities are inconsistent')
    updates = record['updates']
    if not isinstance(updates, dict) or not set(updates) <= set(selected):
        raise RoundRecoveryError('snapshot contributions do not match selected clients')
    if (record['completed'] and (updates or not accepted)) or (
            not record['completed'] and set(updates) != set(accepted)):
        raise RoundRecoveryError('snapshot acceptance requires complete contribution receipts')
    if record['architecture'] != architecture(server.model):
        raise RoundRecoveryError('snapshot native architecture does not match server semantics')
    policy = record['policy']
    if not isinstance(policy, dict) or set(policy) != {'clip_norm', 'noise_scale'}:
        raise RoundRecoveryError('snapshot requires its native aggregation policy')
    policy = {key: _parameter(value) for key, value in policy.items()}
    reference = server.model.get_weights()
    baseline = admit_model_weights(record['global'], reference)
    owned = {client: admit_model_weights(weights, reference) for client, weights in updates.items()}
    # Native preparation may fail, but no serving object/field changes here.
    candidate = keras.models.clone_model(server.model)
    candidate.compile_from_config(server.model.get_compile_config())
    candidate.set_weights(baseline)
    round_id = record['round']
    historical = {pair for pair in server.accepted_updates
                  if isinstance(pair, tuple) and len(pair) == 2 and type(pair[1]) is int and pair[1] < round_id}
    accepted_pairs = historical | {(client, round_id) for client in accepted}
    completed_rounds = {r for r in server.completed_rounds if type(r) is int and r < round_id}
    if record['completed']:
        completed_rounds.add(round_id)
    return round_id, selected, accepted_pairs, owned, record['completed'], baseline, candidate, policy, completed_rounds


def encode(server, record):
    if server.cipher is None:
        raise RoundRecoveryError('snapshot cipher is unavailable')
    raw = json.dumps(record, allow_nan=False, separators=(',', ':')).encode()
    if len(raw) > MAX_SNAPSHOT_BYTES // 2:
        raise RoundRecoveryError('server snapshot exceeds its complete payload budget')
    encrypted = server.cipher.encrypt(raw)
    if len(encrypted) > MAX_SNAPSHOT_BYTES:
        raise RoundRecoveryError('encrypted server snapshot exceeds its budget')
    return encrypted


def _raw(value):
    if value is None:
        return None
    if isinstance(value, str):
        value = value.encode()
    if not isinstance(value, bytes) or len(value) > MAX_SNAPSHOT_BYTES:
        raise RoundRecoveryError('invalid or oversized server snapshot receipt')
    return value


def decode(server, receipt):
    if server.cipher is None:
        raise RoundRecoveryError('snapshot cipher is unavailable')
    return prepare(server, json.loads(server.cipher.decrypt(receipt)))


def apply(server, prepared, receipt):
    round_id, selected, accepted, updates, completed, baseline, candidate, policy, completed_rounds = prepared
    # All native/collection preparation precedes the commit. Publication is
    # assignment under the caller's round owner, with no late decoding/copying.
    server.model = candidate
    server.dp_clip_norm = policy['clip_norm']
    server.dp_noise_scale = policy['noise_scale']
    server.global_weights = baseline
    server.round = server.current_round = round_id
    server.selected_clients = selected
    server.client_weights = updates
    server.accepted_updates = accepted
    server.round_completed = completed
    server.completed_rounds = completed_rounds
    server._snapshot_receipt = receipt
    server._recovery_error = None
    server._snapshot_uncertain = False


def restore(server):
    try:
        receipt = _raw(server.redis.get(SNAPSHOT_KEY))
        if receipt is None:
            if server._snapshot_receipt is not None:
                raise RoundRecoveryError('confirmed server snapshot is missing')
            if server._recovery_error is not None:
                raise RoundRecoveryError(server._recovery_error)
            return False
        if receipt != server._snapshot_receipt or server._snapshot_uncertain or server._recovery_error:
            prepared = decode(server, receipt)
            apply(server, prepared, receipt)
        return True
    except redis.RedisError as exc:
        server._recovery_error = 'server snapshot recovery is temporarily unavailable'
        raise SnapshotUnavailableError(server._recovery_error) from exc
    except Exception as exc:
        server._recovery_error = 'server snapshot recovery is unavailable or incomplete'
        raise RoundRecoveryError(server._recovery_error) from exc


def ensure(server, *, refresh=True):
    if refresh or server._snapshot_uncertain or server._recovery_error is not None:
        restore(server)


def record(server, *, round_id=None, selected=None, updates=None, accepted=None,
           completed=False, baseline=None):
    round_id = server.round if round_id is None else round_id
    selected = server.selected_clients if selected is None else selected
    updates = server.client_weights if updates is None else updates
    accepted = sorted(client for client, r in server.accepted_updates if r == round_id) if accepted is None else accepted
    baseline = server.global_weights if baseline is None else baseline
    return {'schema': 1, 'round': round_id, 'selected': list(selected), 'accepted': list(accepted),
            'updates': {client: [w.tolist() for w in weights] for client, weights in updates.items()},
            'completed': completed, 'global': [w.tolist() for w in baseline],
            'policy': {'clip_norm': _parameter(server.dp_clip_norm),
                       'noise_scale': _parameter(server.dp_noise_scale)},
            'architecture': architecture(server.model)}


def commit(server, data):
    previous = server._snapshot_receipt
    data = copy.deepcopy(data)
    prepared = prepare(server, data)
    desired = encode(server, data)
    try:
        outcome = server.redis.eval(CAS_SCRIPT, 1, SNAPSHOT_KEY,
                                   'missing' if previous is None else 'present', previous or b'', desired)
        if type(outcome) is not int or outcome != 1:
            raise SnapshotConflict('durable server round advanced; retry the operation')
    except Exception as exc:
        # A response loss does not prove that Redis rejected the atomic write.
        try:
            observed = _raw(server.redis.get(SNAPSHOT_KEY))
            if observed == desired:
                apply(server, prepared, desired)
                return
            if observed != previous:
                if observed is None:
                    raise RoundRecoveryError('confirmed snapshot disappeared')
                apply(server, decode(server, observed), observed)
            server._snapshot_uncertain = False
        except Exception as recovery:
            server._snapshot_uncertain = True
            raise SnapshotWriteError('server snapshot commit outcome is unconfirmed') from recovery
        raise SnapshotWriteError('server snapshot was not confirmed; retry') from exc
    apply(server, prepared, desired)
