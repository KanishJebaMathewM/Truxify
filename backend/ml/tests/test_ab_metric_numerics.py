"""Native SQLite/HTTP evaluation and independent decimal arithmetic references."""

import importlib
import json
import math
import sys
from decimal import Decimal, localcontext

import numpy as np
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from services.ab_metric_comparison import finite_mean
from services.ab_testing import ABTestMetrics, ABTestModel


@pytest.fixture
def service(tmp_path, monkeypatch):
    model = ABTestModel(f'sqlite:///{tmp_path / "metrics.db"}')
    monkeypatch.setattr(model, 'get_production_version', lambda: 'prod')
    yield model
    model.engine.dispose()


def log_pair(model, production, shadow, *, metric='profit_margin', test='numeric'):
    for version, observations in [('prod', production), ('shadow', shadow)]:
        for i, value in enumerate(observations):
            model.log_metrics(test, version, {metric: value}, f'{test}-{metric}-{version}-{i}')


def decimal_mean(values):
    # Decimal is independent of the production binary-rational accumulator.
    # 2500 digits cover the entire binary64 exponent span plus these row counts.
    with localcontext() as context:
        context.prec = 2500
        return float(sum((Decimal.from_float(v) for v in values), Decimal(0)) / len(values))


@pytest.mark.parametrize('values', [
    [1e308, 1e308], [sys.float_info.max]*3, [-sys.float_info.max]*2,
    [1e308, 1e-308, -1e308], [1e308, 3., -1e308],
    [math.ulp(0.)]*3, [sys.float_info.max, -sys.float_info.max, math.ulp(0.)],
    [1., 2., 3.], [-1e-308, -1e-308],
])
def test_native_ledger_mean_matches_decimal_full_range_and_json(service, values):
    log_pair(service, values, values)
    result = service.evaluate_test('numeric')
    expected = decimal_mean(values)
    observed = result['results']['profit_margin']
    assert observed['production'] == expected and observed['shadow'] == expected
    assert math.isfinite(expected) and result['has_comparison']
    json.dumps(result, allow_nan=False)


def test_native_finite_delta_has_representable_200_percent(service):
    log_pair(service, [-1e308], [1e308])
    result = service.evaluate_test('numeric')
    with localcontext() as context:
        context.prec = 2500
        p, s = Decimal.from_float(-1e308), Decimal.from_float(1e308)
        expected = float((s-p)/abs(p)*100)
    assert expected == 200. and result['results']['profit_margin']['improvement'] == expected
    assert result['shadow_better'] and not result['should_rollback']
    json.dumps(result, allow_nan=False)


def test_outside_display_range_is_explicit_without_losing_valid_vote(service):
    log_pair(service, [1e-308], [1e308])
    result = service.evaluate_test('numeric')
    observed = result['results']['profit_margin']
    assert observed['improvement'] is None
    assert observed['improvement_status'] == 'outside_float_range'
    assert result['has_comparison'] and result['shadow_better'] and not result['should_rollback']
    json.dumps(result, allow_nan=False)


def test_signed_equal_profit_has_same_legacy_retention_outcome(service):
    for name, value in [('positive', 10.), ('negative', -10.)]:
        log_pair(service, [value], [value], test=name)
    positive, negative = (service.evaluate_test(name) for name in ('positive', 'negative'))
    assert positive['results']['profit_margin']['improvement'] == negative['results']['profit_margin']['improvement'] == 0.
    assert positive['shadow_better'] is negative['shadow_better'] is True
    assert not positive['should_rollback'] and not negative['should_rollback']


def test_positive_native_threshold_boundaries_and_strict_ties_stay_compatible(service):
    for baseline in (.1, 1., 10., 1e308, math.ulp(0.), sys.float_info.max):
        for threshold in (0., .5, .95, .99, 1., 1.5):
            service.threshold = threshold
            boundary = baseline * threshold
            for candidate in (baseline / 2, baseline, math.nextafter(baseline, 0.)):
                for name, lower in [('profit_margin', False), ('loss', True)]:
                    expected = candidate < boundary if lower else candidate > boundary
                    assert service.is_shadow_better({name:{'production':baseline, 'shadow':candidate}}) is expected
    service.threshold = .95
    assert not service.is_shadow_better({'profit_margin':{'production':10., 'shadow':9.5}})


def test_invalid_legacy_metric_never_changes_valid_vote_denominator(service):
    log_pair(service, [10.], [20.])
    original = service.evaluate_test('numeric')
    with service.Session() as session:
        session.add_all([ABTestMetrics(test_id='numeric', model_version=version,
            metric_name='unavailable_score', metric_value=float('inf'), sample_size=1,
            request_id='legacy-'+version, status='active') for version in ('prod', 'shadow')])
        session.commit()
    actual = service.evaluate_test('numeric')
    assert original['shadow_better'] is actual['shadow_better'] is True
    assert original['should_rollback'] is actual['should_rollback'] is False
    invalid = actual['results']['unavailable_score']
    assert invalid['production'] is None and invalid['shadow'] is None
    assert invalid['improvement'] is None and invalid['improvement_status'] == 'invalid_observations'
    assert service.is_shadow_better(actual['results']) is True
    json.dumps(actual, allow_nan=False)


def test_invalid_tail_refuses_complete_role_group_without_rewriting_database(service):
    log_pair(service, [10.], [20.])
    with service.Session() as session:
        session.add(ABTestMetrics(test_id='numeric', model_version='prod', metric_name='profit_margin',
                metric_value=None, sample_size=1, request_id='legacy-null', status='active'))
        session.commit()
    result = service.evaluate_test('numeric')
    assert not result['has_comparison'] and not result['should_rollback']
    assert result['results']['profit_margin']['production'] is None
    assert result['results']['profit_margin']['shadow'] == 20.
    with service.Session() as session:
        assert session.query(ABTestMetrics).count() == 3
    json.dumps(result, allow_nan=False)


def test_direct_votes_skip_missing_nonfinite_and_nonnumeric_pairs(service):
    result = {'good':{'production':1.,'shadow':2.}}
    for bad in (None, float('inf'), float('nan'), True, '2'):
        result[str(bad)] = {'production':bad, 'shadow':2.}
    assert service.is_shadow_better(result)
    assert not service.is_shadow_better({'bad':{'production':float('inf'),'shadow':float('inf')}})


@pytest.mark.parametrize('value', [True, '0.95', None, float('nan'), float('inf'), -1.])
def test_invalid_threshold_fails_before_native_database_creation(tmp_path, value):
    path = tmp_path / 'not-created.db'
    with pytest.raises((TypeError, ValueError)):
        ABTestModel('sqlite:///'+str(path), threshold=value)
    assert not path.exists()


@pytest.mark.parametrize('value', [True, '1', None, float('nan'), float('inf')])
def test_direct_improvement_refuses_invalid_numeric_inputs(service, value):
    with pytest.raises((TypeError, ValueError)):
        service.calculate_improvement(value, 1.)


def test_zero_baseline_keeps_explicit_historical_absolute_display(service):
    log_pair(service, [0.], [10.])
    result = service.evaluate_test('numeric')['results']['profit_margin']
    assert result['improvement'] == 1000.
    assert result['improvement_basis'] == 'absolute_delta_x100'
    assert service.calculate_improvement(0., 10., False) == -1000.


def test_actual_http_evaluation_serializes_extremes_and_restored_router(service, tmp_path, monkeypatch):
    monkeypatch.setenv('DATABASE_URL', 'sqlite:///'+str(tmp_path/'route-bootstrap.db'))
    routes = importlib.import_module('routes.ab_testing')
    monkeypatch.setattr(routes, 'ab_service', service)
    app = FastAPI()
    app.include_router(routes.router)
    log_pair(service, [-1e308], [1e308])
    with TestClient(app) as client:
        response = client.get('/ab-testing/evaluate/numeric')
    assert response.status_code == 200
    body = response.json()
    assert body['results']['profit_margin']['improvement'] == 200.
    assert body['has_comparison'] and body['shadow_better']


def test_native_mean_random_scale_controls_against_independent_decimal():
    rng = np.random.RandomState(731)
    for _ in range(20):
        values = [math.ldexp(float(rng.uniform(-1,1)), int(rng.randint(-1022,1023))) for _ in range(12)]
        actual, invalid = finite_mean(values)
        assert invalid == 0 and actual == decimal_mean(values)


def test_invalid_legacy_metric_name_is_reported_without_a_vote(service):
    log_pair(service, [10.], [20.])
    with service.Session() as session:
        session.add(ABTestMetrics(test_id='numeric', model_version='prod', metric_name=None,
                    metric_value=1., sample_size=1, request_id='legacy-name', status='active'))
        session.commit()
    result = service.evaluate_test('numeric')
    assert result['invalid_metric_rows'] == 1 and result['shadow_better']
    assert set(result['results']) == {'profit_margin'}
    json.dumps(result, allow_nan=False)
