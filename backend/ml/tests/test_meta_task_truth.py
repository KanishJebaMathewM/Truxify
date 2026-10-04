"""Actual Gaussian binary halfspace sampling and ASGI truth contract."""
from statistics import NormalDist

import httpx
import numpy as np
import pytest
from fastapi import FastAPI
from meta.model import TaskGenerator


def generator(weights=(1., 0.), bias=0.):
    np.random.seed(42)
    value = TaskGenerator(num_tasks=1, input_dim=len(weights))
    value.tasks = [{'weights': np.array(weights)[:, None], 'bias': np.array([bias]), 'task_id': 0}]
    return value


def assert_truth(value, task, count):
    native = value.tasks[0]
    for label, rows in task['support_set'].items():
        assert rows.shape == (count, value.input_dim)
        actual = (rows @ native['weights'] + native['bias'] > 0).astype(int).reshape(-1)
        assert np.all(actual == int(label))
    np.testing.assert_array_equal(task['query_y'], (task['query_x'] @ native['weights'] + native['bias'] > 0).astype(int))
    assert task['query_x'].shape == (10, value.input_dim)
    assert task['query_y'].shape == (10, 1)


@pytest.mark.parametrize('weights,bias', [((1., 0.), 0.), ((-1., 0.), 0.), ((3., 4.), 2.), ((1.,), -8.), ((1.,), 8.), ((3e-300, 4e-300), 1e-300), ((3e300, 4e300), 1e300)])
def test_support_and_queries_share_actual_latent_truth(weights, bias):
    value = generator(weights, bias)
    original = value.tasks[0]['weights'].copy()
    task = value.generate_few_shot_task(12)
    assert_truth(value, task, 12)
    assert set(task) == {'support_set', 'query_x', 'query_y'}
    assert set(task['support_set']) == {'0', '1'}
    np.testing.assert_array_equal(value.tasks[0]['weights'], original)


def test_conditional_gaussian_statistics_preserve_parallel_and_orthogonal_components():
    value = generator((1., 0.), -2.)
    task = value.generate_few_shot_task(12000)
    rows = task['support_set']['1']
    gaussian = NormalDist()
    threshold = 2.
    mean = gaussian.pdf(threshold) / (1 - gaussian.cdf(threshold))
    variance = 1 + threshold * mean - mean * mean
    assert rows[:, 0].mean() == pytest.approx(mean, abs=0.02)
    assert rows[:, 0].var() == pytest.approx(variance, abs=0.02)
    assert rows[:, 1].mean() == pytest.approx(0, abs=0.03)
    assert rows[:, 1].var() == pytest.approx(1, abs=0.04)
    assert abs(np.corrcoef(rows.T)[0, 1]) < 0.04


def test_rare_tail_uses_exact_finite_proposal_budget(monkeypatch):
    value = generator((1.,), -10.)
    calls = []
    original = np.random.exponential
    def counted(scale, size):
        calls.append(size)
        return original(scale, size)
    monkeypatch.setattr(np.random, 'exponential', counted)
    task = value.generate_few_shot_task(5)
    assert calls == [4 * 5 + 64]
    assert_truth(value, task, 5)


@pytest.mark.parametrize('count', [0, -1, 1.5, True])
def test_invalid_shot_count_is_rejected(count):
    with pytest.raises(ValueError, match='positive integer'):
        generator().generate_few_shot_task(count)


@pytest.mark.parametrize('classes', [0, 1, 3])
def test_binary_task_rejects_unsupported_class_arity(classes):
    with pytest.raises(ValueError, match='two classes'):
        generator().generate_few_shot_task(5, classes)


@pytest.mark.parametrize('weights,bias', [((0., 0.), 1.), ((float('nan'), 1.), 0.), ((1.,), float('inf')), ((1e-300,), -1e300)])
def test_unavailable_task_fails_explicitly(weights, bias):
    with pytest.raises(ValueError):
        generator(weights, bias).generate_few_shot_task()


def test_unrepresentable_tail_is_bounded_failure():
    with pytest.raises(ValueError):
        generator((1.,), -1e18).generate_few_shot_task()


def test_proposal_exhaustion_never_loops_or_publishes_bad_labels(monkeypatch):
    value = generator((1.,), -10.)
    calls = []
    def impossible(scale, size):
        calls.append(size)
        return np.zeros(size)
    monkeypatch.setattr(np.random, 'exponential', impossible)
    with pytest.raises(ValueError, match='budget exhausted'):
        value.generate_few_shot_task(5)
    assert calls == [84]


@pytest.mark.asyncio
async def test_actual_asgi_binary_task_truth_validation_and_unavailability(monkeypatch):
    from routes import meta_routes as r
    value = generator()
    monkeypatch.setattr(r, 'task_generator', value)
    app = FastAPI()
    app.include_router(r.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
        response = await client.get('/meta/task/few-shot?k_shot=7')
        assert response.status_code == 200
        body = response.json()['data']
        task = {'support_set': {key: np.array(rows) for key, rows in body['support_set'].items()},
                'query_x': np.array(body['query_x']), 'query_y': np.array(body['query_y'])}
        assert_truth(value, task, 7)
        assert (await client.get('/meta/task/few-shot?num_classes=3')).status_code == 422
        assert (await client.get('/meta/task/few-shot?k_shot=0')).status_code == 422
        value.tasks[0]['weights'][:] = 0
        unavailable = await client.get('/meta/task/few-shot')
        assert unavailable.status_code == 503
        assert unavailable.json() == {'detail': 'Binary task generation unavailable'}


def test_no_task_available_fails_before_sampling():
    value = generator()
    value.tasks = []
    with pytest.raises(ValueError):
        value.generate_few_shot_task()


def test_wrong_feature_dimensions_fail_before_sampling():
    value = generator()
    value.tasks[0]['weights'] = np.ones((3, 1))
    with pytest.raises(ValueError, match='feature dimensions'):
        value.generate_few_shot_task()
