# Native PINN coordinate derivatives

The mounted `pinns.model.PhysicsLoss` implements its documented equations with a
scalar field `[rows,1]`. Evolution equations use coordinates `[space,time]`:

- diffusion: `u_t - D*u_xx`
- advection: `u_t + v*u_x`
- Burgers: `u_t + u*u_x - nu*u_xx`

Poisson treats every supplied coordinate as spatial: `-sum_i u_xixi - f`.
Forcing is scalar or `[rows,1]`. Mixed second partials are excluded from the
Laplacian; a vector forcing field is rejected instead of silently broadcasting.
These are rowwise-field derivatives, matching the native feed-forward PINN.

The trainer makes private collocation leaves with gradients enabled before
forward evaluation. Caller tensors, grad flags and upstream graphs remain
intact across repeated steps. Constant/affine fields retain zero derivative
graphs so higher derivatives and parameter backward remain defined.

```sh
PYTHONPATH=backend/ml OMP_NUM_THREADS=1 python -m pytest -q \
  backend/ml/tests/test_pinn_coordinate_derivatives.py
python -m ruff check backend/ml/pinns/model.py \
  backend/ml/tests/test_pinn_coordinate_derivatives.py --select E9,F63,F7,F82
```

29 new native tests pass; with existing PINN/axle-wear controls,37 PASS/1 explicit
unchanged axle assertion excluded. The excluded
`test_slope_interpreted_as_degrees_matches_radian_analytic_value` expects
`max(0, negative_force)**2 > 0`, fails identically on main, and is outside this
scalar PDE implementation. Manufactured exact solutions, mixed-partial
counterexamples, dimension-dependent Poisson traces, constants, a closed-form
parameter gradient, repeated native Adam updates and actual local ASGI training
are covered. Identical tests on unchanged production:28fail/1pass. ASGI uses the
actual mounted handler and small real native PINN/trainer; no production fit or
claim that default thousand-epoch runtime is benchmarked.

This corrects previously incorrect residual semantics; callers of evolution
losses must use exactly `[space,time]`. Separate NumPy axle-wear physics,
vehicle/business coefficients, checkpoint publication, providers and deployment
are unchanged. Focused native CI does not establish full backend CI.
