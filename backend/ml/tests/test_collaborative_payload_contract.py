"""Native aligned payload admission, SVD references and public JSON/ownership."""

import importlib
import json

import numpy as np
import pytest

cf = importlib.import_module('app.models.collaborative_filter')
contract = importlib.import_module('app.models.collaborative_payload')


def payload():
    return {
        'user_load_matrix': np.array([[5., 1., 0.], [0., 4., 3.]]),
        'user_truck_matrix': np.array([[1., 5.], [4., 0.]]),
        'user_load_approx': np.array([[4.5, 1., 2.], [1., 4., 3.]]),
        'user_truck_approx': np.array([[1., 4.5], [4., 2.]]),
        'user_ids': ['u', 'v'], 'load_ids': ['l0', 'l1', 'l2'], 'truck_ids': ['t0', 't1'],
        'popular_loads': np.array([0, 1, 2]), 'popular_trucks': np.array([0, 1]),
    }


def snapshot(model):
    return model.recommend_loads('u', [], 3), model.recommend_trucks('u', [], 2)


@pytest.mark.parametrize('bad', ['score_nan', 'score_inf', 'score_shape', 'truck_shape',
                                'duplicate_users', 'duplicate_loads', 'empty_id', 'nonstr_id',
                                'user_count', 'ratings_negative', 'ratings_over5', 'ratings_nan',
                                'boolean_matrix', 'complex_matrix', 'popular_duplicate',
                                'popular_outside', 'popular_float', 'popular_wrong_order', 'missing'])
def test_complete_bad_refresh_retains_last_good_then_corrected_retry(bad, monkeypatch):
    model = cf.CollaborativeFilter()
    model._publish_payload(payload())
    before = snapshot(model)
    candidate = payload()
    if bad == 'score_nan':
        candidate['user_load_approx'][-1, -1] = np.nan
    elif bad == 'score_inf':
        candidate['user_truck_approx'][-1, -1] = np.inf
    elif bad == 'score_shape':
        candidate['user_load_approx'] = np.ones((1, 3))
    elif bad == 'truck_shape':
        candidate['user_truck_matrix'] = np.ones((2, 3))
    elif bad == 'duplicate_users':
        candidate['user_ids'] = ['u', 'u']
    elif bad == 'duplicate_loads':
        candidate['load_ids'] = ['l0'] * 3
    elif bad == 'empty_id':
        candidate['load_ids'][-1] = ''
    elif bad == 'nonstr_id':
        candidate['truck_ids'][-1] = True
    elif bad == 'user_count':
        candidate['user_ids'] = ['u']
    elif bad.startswith('ratings'):
        candidate['user_truck_matrix'][-1, -1] = {'ratings_negative': -1., 'ratings_over5': 6., 'ratings_nan': np.nan}[bad]
    elif bad == 'boolean_matrix':
        candidate['user_load_matrix'] = np.ones((2, 3), dtype=bool)
    elif bad == 'complex_matrix':
        candidate['user_truck_approx'] = np.ones((2, 2), dtype=complex)
    elif bad == 'popular_duplicate':
        candidate['popular_loads'] = np.array([0, 1, 1])
    elif bad == 'popular_outside':
        candidate['popular_trucks'] = np.array([0, 2])
    elif bad == 'popular_float':
        candidate['popular_loads'] = np.array([0., 1., 2.])
    elif bad == 'popular_wrong_order':
        candidate['popular_loads'] = np.array([2, 1, 0])
    else:
        del candidate['user_truck_matrix']
    monkeypatch.setattr(cf, 'model_exists', lambda _: True)
    monkeypatch.setattr(cf, 'load_model', lambda _: candidate)
    with pytest.raises((ValueError, KeyError)):
        model.load()
    assert snapshot(model) == before
    candidate = payload()
    candidate['load_ids'] = ['new0', 'new1', 'new2']
    model.load()
    assert model.recommend_loads('u', [], 1)['recommendations'][0]['load_id'] == 'new0'


def test_source_mutation_cannot_change_captured_numerical_state_or_ids():
    model = cf.CollaborativeFilter()
    source = payload()
    model._publish_payload(source)
    before = snapshot(model)
    captured = model._capture_recommendation_state('u', 'load')
    for name in ('user_ids', 'load_ids', 'truck_ids'):
        source[name][:] = ['mutated'] * len(source[name])
    for name, value in source.items():
        if isinstance(value, np.ndarray):
            value.fill(0)
            published = getattr(model, name if not name.startswith('popular') else '_'+name)
            assert not np.shares_memory(value, published)
            assert not published.flags.writeable
            with pytest.raises(ValueError):
                published.flat[0] = 0
    assert snapshot(model) == before
    assert captured[1] == ['l0', 'l1', 'l2']
    np.testing.assert_array_equal(captured[3][0], [4.5, 1., 2.])


def test_public_seen_item_and_cold_fallback_outputs_are_finite_strict_json():
    model = cf.CollaborativeFilter()
    model._publish_payload(payload())
    known = model.recommend_loads('u', [{'load_id': 'l0'}], 3)
    cold = model.recommend_loads('unknown', [{'load_id': 'l0'}], 3)
    assert [r['load_id'] for r in known['recommendations']] == ['l2', 'l1']
    assert [r['load_id'] for r in cold['recommendations']] == ['l1', 'l2']
    assert json.loads(json.dumps(known, allow_nan=False)) == known
    assert json.loads(json.dumps(cold, allow_nan=False)) == cold


def independent_svd(matrix):
    observed = matrix > 0
    means = []
    for row, keep in zip(matrix, observed):
        means.append(float(row[keep].mean()) if keep.any() else float(matrix[observed].mean()))
    means = np.array(means)
    centered = np.zeros_like(matrix)
    for i, row in enumerate(matrix):
        for j, value in enumerate(row):
            centered[i, j] = value - means[i] if value > 0 else 0
    u, s, v = np.linalg.svd(centered, full_matrices=False)
    return (u[:, :cf.LATENT_K] * s[:cf.LATENT_K]) @ v[:cf.LATENT_K] + means[:, None]


def test_native_training_candidates_match_independent_svd_and_are_owned_before_storage(monkeypatch):
    model = cf.CollaborativeFilter()
    source = payload()
    expected_load = independent_svd(source['user_load_matrix'])
    expected_truck = independent_svd(source['user_truck_matrix'])
    saved = []
    monkeypatch.setattr(cf, '_generate_synthetic_data', lambda: source)

    def save(candidate, name, metrics):
        assert name == cf.MODEL_NAME
        np.testing.assert_allclose(candidate['user_load_approx'], expected_load)
        np.testing.assert_allclose(candidate['user_truck_approx'], expected_truck)
        assert all(not v.flags.writeable for v in candidate.values() if isinstance(v, np.ndarray))
        saved.append(candidate)
        source['load_ids'][0] = 'mutated-during-storage'
        source['user_load_matrix'].fill(0)

    monkeypatch.setattr(cf, 'save_model', save)
    metrics = model.train()
    assert metrics == {'n_users': 2, 'n_loads': 3, 'n_trucks': 2, 'latent_k': cf.LATENT_K}
    np.testing.assert_allclose(model.user_load_approx, expected_load)
    assert model.load_ids == ['l0', 'l1', 'l2']
    assert len(saved) == 1
    json.dumps(snapshot(model), allow_nan=False)


def test_invalid_training_metadata_rejected_before_native_svd_or_persistence(monkeypatch):
    model = cf.CollaborativeFilter()
    model._publish_payload(payload())
    before = snapshot(model)
    source = payload()
    source['truck_ids'] = ['t0', 't0']
    calls = []
    monkeypatch.setattr(cf, '_generate_synthetic_data', lambda: source)
    monkeypatch.setattr(cf, 'save_model', lambda *args: calls.append('storage'))
    native = cf._svd_reconstruct

    def observe(*args):
        calls.append('svd')
        return native(*args)

    monkeypatch.setattr(cf, '_svd_reconstruct', observe)
    with pytest.raises(ValueError):
        model.train()
    assert not calls
    assert snapshot(model) == before


@pytest.mark.parametrize('stage', ['candidate', 'storage'])
def test_failed_native_candidate_or_storage_keeps_prior_then_retry(stage, monkeypatch):
    model = cf.CollaborativeFilter()
    model._publish_payload(payload())
    before = snapshot(model)
    monkeypatch.setattr(cf, '_generate_synthetic_data', payload)
    native = cf._svd_reconstruct
    calls = []

    def svd(*args):
        result = native(*args)
        result[-1, -1] = np.nan
        return result

    def failed_save(*args):
        calls.append('storage')
        raise OSError('controlled storage boundary failure')

    monkeypatch.setattr(cf, 'save_model', failed_save if stage == 'storage' else lambda *args: calls.append('storage'))
    if stage == 'candidate':
        monkeypatch.setattr(cf, '_svd_reconstruct', svd)
    with pytest.raises((ValueError, OSError)):
        model.train()
    assert calls == (['storage'] if stage == 'storage' else [])
    assert snapshot(model) == before
    monkeypatch.setattr(cf, '_svd_reconstruct', native)
    monkeypatch.setattr(cf, 'save_model', lambda *args: None)
    model.train()
    json.dumps(snapshot(model), allow_nan=False)


def test_bounded_native_payload_rejected_before_copy(monkeypatch):
    candidate = payload()
    monkeypatch.setattr(contract, 'MAX_CELLS', 1)
    with pytest.raises(ValueError, match='cell budget'):
        contract.own_candidate(candidate)


def test_empty_users_items_and_popularity_ties_retain_native_fallback():
    candidate = payload()
    candidate['user_ids'] = []
    for kind, columns in (('load', 3), ('truck', 2)):
        candidate[f'user_{kind}_matrix'] = np.empty((0, columns))
        candidate[f'user_{kind}_approx'] = np.empty((0, columns))
    model = cf.CollaborativeFilter()
    model._publish_payload(candidate)
    assert len(model.recommend_loads('unknown', [], 3)['recommendations']) == 3
    candidate['load_ids'] = []
    candidate['user_load_matrix'] = np.empty((0, 0))
    candidate['user_load_approx'] = np.empty((0, 0))
    candidate['popular_loads'] = np.array([], dtype=int)
    model._publish_payload(candidate)
    assert model.recommend_loads('unknown', [], 3) == {'recommendations': []}


def test_actual_default_synthetic_training_and_native_pickle_roundtrip_preserve_scores(monkeypatch):
    import pickle

    generator = cf._generate_synthetic_data
    source = generator()
    expected_load = independent_svd(source['user_load_matrix'])
    expected_truck = independent_svd(source['user_truck_matrix'])
    serialized = []
    monkeypatch.setattr(cf, 'save_model', lambda candidate, *_: serialized.append(pickle.dumps(candidate)))
    model = cf.CollaborativeFilter()
    model.train()
    np.testing.assert_allclose(model.user_load_approx, expected_load)
    np.testing.assert_allclose(model.user_truck_approx, expected_truck)
    restored = cf.CollaborativeFilter()
    restored._publish_payload(pickle.loads(serialized[0]))
    assert snapshot(restored) == snapshot(model)
    assert restored.recommend_loads('user_001', [{'load_id': 'load_001'}], 3) == model.recommend_loads('user_001', [{'load_id': 'load_001'}], 3)
    assert not restored.user_load_approx.flags.writeable
    json.dumps(restored.recommend_trucks('unknown', [], 3), allow_nan=False)
