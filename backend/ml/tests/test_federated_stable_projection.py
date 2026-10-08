"""Actual NumPy coordinate median/projection against independent scalar math."""
from decimal import Decimal, localcontext

import numpy as np
import pytest

from federated.fl_server import robust_aggregate


def decimal_reference(layers, prior=None, radius=1.):
    values = np.asarray(layers, dtype=np.float64); shape = values.shape[1:]
    columns = values.reshape(len(values), -1).T; medians = []
    with localcontext() as context:
        context.prec = 1200
        for column in columns:
            ordered = sorted(Decimal.from_float(float(v)) for v in column)
            n = len(ordered)
            medians.append(ordered[n // 2] if n % 2 else (ordered[n // 2 - 1] + ordered[n // 2]) / 2)
        if prior is not None and radius > 0:
            baseline = [Decimal.from_float(float(v)) for v in np.asarray(prior).reshape(-1)]
            delta = [m - p for m, p in zip(medians, baseline)]
            norm = sum(d * d for d in delta).sqrt()
            limit = Decimal.from_float(radius)
            if norm > limit:
                medians = [p + d * limit / norm for p, d in zip(baseline, delta)]
        return np.array([float(v) for v in medians]).reshape(shape)


@pytest.mark.parametrize('layers', [
    [[1e308], [1e308]], [[-1e308], [-1e308]], [[-1e308], [1e308]],
    [[1e307, 1e308], [1e308, 1e308]], [[1., 4.], [3., 2.], [1e308, -1e308]],
    [[np.nextafter(0., 1.)], [np.nextafter(0., 1.) * 2]],
    [np.array(2.), np.array(4.)],
])
def test_finite_coordinate_median_matches_decimal_reference(layers):
    arrays = [np.array(v) for v in layers]
    actual = robust_aggregate(arrays); expected = decimal_reference(arrays)
    np.testing.assert_allclose(actual, expected, rtol=1e-15, atol=0)
    assert np.isfinite(actual).all()


@pytest.mark.parametrize('prior,median,radius', [
    ([0., 0.], [1e308, 1e308], 1.), ([0., 0.], [-1e308, 1e308], .1),
    ([3., 4.], [1e308, -1e308], 2.), ([0., 0.], [3., 4.], 2.),
    ([1., 2.], [1.1, 2.1], 1.), ([0., 0.], [1e-300, 1e-300], 1e-301),
    ([1e308, -1e308], [-1e308, 1e308], 1.),
    ([1e308, 0.], [1e308, 1.], .1),
    ([1e308, 0.], [1e308, 1e-300], 1e-301),
])
def test_scale_safe_projection_direction_and_radius_match_decimal(prior, median, radius):
    baseline = np.array(prior); arrays = [np.array(median)]
    actual = robust_aggregate(arrays, baseline, radius)
    expected = decimal_reference(arrays, baseline, radius)
    np.testing.assert_allclose(actual, expected, rtol=2e-14, atol=0)
    assert np.isfinite(actual).all()
    if np.max(np.abs(baseline)) < 1e10:
        # A scaled norm independently avoids overflow in this assertion too.
        delta = actual - baseline; scale = np.max(np.abs(delta))
        norm = 0 if scale == 0 else scale * np.sqrt(np.sum((delta / scale) ** 2))
        assert norm <= radius * (1 + 1e-12)


def test_client_order_and_array_ownership_preserve_ordinary_compatibility():
    layers = [np.array([[1., 2.], [3., 4.]]), np.array([[2., 4.], [6., 8.]]), np.array([[5., 1.], [2., 3.]])]
    prior = np.zeros((2, 2)); originals = [x.copy() for x in layers]; baseline = prior.copy()
    result = robust_aggregate(layers, prior, 1.)
    np.testing.assert_array_equal(result, robust_aggregate(list(reversed(layers)), prior, 1.))
    expected = np.median(np.stack(layers), axis=0); expected /= np.linalg.norm(expected)
    np.testing.assert_allclose(result, expected, rtol=1e-14, atol=0)
    result[:] = -77
    for actual, original in zip(layers, originals): np.testing.assert_array_equal(actual, original)
    np.testing.assert_array_equal(prior, baseline)


def test_radius_zero_keeps_existing_clipping_disabled_contract():
    arrays = [np.array([3., 4.])]
    np.testing.assert_array_equal(robust_aggregate(arrays, np.zeros(2), 0), [3., 4.])


@pytest.mark.parametrize('bad', ['empty', 'empty_layer', 'shape', 'prior_shape', 'nan', 'inf', 'prior_nan',
                                  'complex', 'text', 'radius_nan', 'radius_inf', 'radius_negative',
                                  'radius_bool', 'radius_text', 'radius_list'])
def test_invalid_aggregate_rejects_without_modifying_input_arrays(bad):
    arrays = [np.array([1., 2.]), np.array([3., 4.])]; prior = np.zeros(2); radius = 1.
    if bad == 'empty': arrays = []
    elif bad == 'empty_layer': arrays = [np.array([])]
    elif bad == 'shape': arrays[-1] = arrays[-1][:1]
    elif bad == 'prior_shape': prior = np.zeros((1, 2))
    elif bad == 'nan': arrays[-1][-1] = np.nan
    elif bad == 'inf': arrays[-1][-1] = np.inf
    elif bad == 'prior_nan': prior[-1] = np.nan
    elif bad == 'complex': arrays[-1] = arrays[-1].astype(complex)
    elif bad == 'text': arrays[-1] = np.array(['1', '2'])
    else:
        radius = {'radius_nan': np.nan, 'radius_inf': np.inf, 'radius_negative': -1.,
                  'radius_bool': True, 'radius_text': '1', 'radius_list': [1]}[bad]
    originals = [x.copy() for x in arrays]; baseline = prior.copy()
    with pytest.raises(ValueError): robust_aggregate(arrays, prior, radius)
    for actual, original in zip(arrays, originals): np.testing.assert_array_equal(actual, original)
    np.testing.assert_array_equal(prior, baseline)
