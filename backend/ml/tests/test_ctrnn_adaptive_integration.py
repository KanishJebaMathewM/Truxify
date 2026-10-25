"""Independent trajectory references and native adaptive endpoint admission."""
import numpy as np
import pytest
from models.ctrnn_imputer import ContinuousTimeRnnImputer


def rk4(weights, bias, initial, duration):
    # Independent fixed-step fourth-order oracle, not the production integrator.
    steps = max(1, int(np.ceil(duration / 0.002)))
    step = duration / steps
    state = initial.copy()
    def rhs(y):
        return -y + np.tanh(weights @ y + bias)
    for _ in range(steps):
        a = rhs(state)
        b = rhs(state + step * a / 2)
        c = rhs(state + step * b / 2)
        d = rhs(state + step * c)
        state += step * (a + 2*b + 2*c + d) / 6
    return state


@pytest.mark.parametrize('seconds', [0.1, 5, 45, 60, 180, 600, 1200, 3600])
@pytest.mark.parametrize('coords', [(12.97, -77.59), (-90., 180.)])
def test_default_matches_independent_rk4(seconds, coords):
    model = ContinuousTimeRnnImputer()
    initial = np.array([coords[0]/90, coords[1]/180, 0., 0.])
    expected = rk4(model.W, model.bias, initial, seconds/60)[:2] * [90,180]
    np.testing.assert_allclose(model.impute_missing_telemetry(coords, seconds), expected,
                               rtol=2e-8, atol=3e-9)


@pytest.mark.parametrize('dimension', [2, 3, 4, 7])
def test_coupled_field_and_dimension(dimension):
    model = ContinuousTimeRnnImputer(dimension)
    rng = np.random.default_rng(dimension)
    model.W = rng.normal(0, .1, (dimension,dimension))
    model.bias = rng.normal(0, .05, dimension)
    initial = np.zeros(dimension)
    initial[:2] = [.2, -.3]
    expected = rk4(model.W, model.bias, initial, 10)[:2]*[90,180]
    np.testing.assert_allclose(model.impute_missing_telemetry((18., -54.),600), expected,
                               rtol=2e-8, atol=3e-9)


def test_closed_form_linear_decay_and_immutability():
    model = ContinuousTimeRnnImputer(3)
    model.W[:] = 0
    coords = np.array([18., -54.])
    weights, bias = model.W.copy(), model.bias.copy()
    np.testing.assert_allclose(model.impute_missing_telemetry(coords, 300),
                               coords*np.exp(-5),rtol=2e-8)
    np.testing.assert_array_equal(coords,[18.,-54.])
    np.testing.assert_array_equal(model.W,weights)
    np.testing.assert_array_equal(model.bias,bias)


def test_long_gap_preserves_hemisphere_and_decays():
    model = ContinuousTimeRnnImputer()
    results = np.array([model.impute_missing_telemetry((12.97,-77.59), t)
                        for t in [0,60,600,1200]])
    assert (results[:,0] > 0).all() and (results[:,1] < 0).all()
    assert (np.diff(np.abs(results),axis=0) < 0).all()


def test_exact_zero_and_public_euler_compatibility():
    model = ContinuousTimeRnnImputer()
    assert model.impute_missing_telemetry((12.97,-77.59),0) == (12.97,-77.59)
    state = np.array([1.,-.2,.3,.4])
    np.testing.assert_array_equal(model.ode_step(state,.5),
                                 state+.5*(-state+np.tanh(model.W@state+model.bias)))


@pytest.mark.parametrize('coords,seconds', [
    ((91,0),1), ((0,181),1), ((np.nan,0),1), ((0,np.inf),1),
    ((1,),1), ((1,2,3),1), (('1','2'),1), ((True,False),1),
    ((1,2),-1), ((1,2),np.inf), ((1,2),np.nan), ((1,2),True), ((1,2),'3')])
def test_invalid_admission(coords, seconds):
    model = ContinuousTimeRnnImputer()
    before = model.W.copy()
    with pytest.raises(ValueError):
        model.impute_missing_telemetry(coords,seconds)
    np.testing.assert_array_equal(model.W,before)


@pytest.mark.parametrize('dimension',[0,1,-1,2.5,True])
def test_invalid_dimension(dimension):
    with pytest.raises(ValueError):
        ContinuousTimeRnnImputer(dimension)


@pytest.mark.parametrize('field',['shape','nan','complex','bias'])
def test_invalid_dynamics_even_at_zero_gap(field):
    model = ContinuousTimeRnnImputer()
    if field == 'shape': model.W = np.zeros((2,2))
    elif field == 'nan': model.W[0,0] = np.nan
    elif field == 'complex': model.W = model.W.astype(complex)
    else: model.bias = np.zeros(2)
    with pytest.raises(ValueError):
        model.impute_missing_telemetry((1,2),0)


def test_genuine_solver_budget_exhaustion():
    model = ContinuousTimeRnnImputer()
    before = model.W.copy()
    with pytest.raises(RuntimeError,match='evaluation budget'):
        model.impute_missing_telemetry((12.97,-77.59),1e9)
    np.testing.assert_array_equal(model.W,before)


def test_subnormal_gap_identity():
    model = ContinuousTimeRnnImputer()
    assert model.impute_missing_telemetry((12.97,-77.59),np.nextafter(0.,1.)) == (12.97,-77.59)
