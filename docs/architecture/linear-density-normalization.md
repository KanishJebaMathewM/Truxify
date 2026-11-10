# Linear coordinate density normalization

The historical `ContinuousNormalizingFlowDensityEstimator` currently implements
a standalone NumPy linear map `z = x W`. This change normalizes that existing
baseline; it does not implement a learned Neural ODE, FFJORD or a training pipeline.
No mounted caller was found beyond the model tests.

For one row with d channels, the repaired log density is
`log(abs(det(W))) - d/2 * log(2*pi) - ||x W||^2/2`.
For row-vector coordinates its covariance is `inverse(W W.T)`. This agrees with
the [SciPy multivariate Gaussian formula](https://docs.scipy.org/doc/scipy/reference/generated/scipy.stats.multivariate_normal.html).
`log_likelihood_per_coordinate` returns these individual scores;
`log_likelihood` retains a scalar independent joint score by summing all rows.
The Gaussian constant and Jacobian apply once per row, preserving partition and
permutation invariance. A typed empty `(0, channels)` matrix has log identity 0.

## Admission and arithmetic

Complete inputs and W are copied before scoring. Coordinates must be a finite
real `(N, channels)` matrix; W must be a finite invertible square matrix with the
same channels. Strings, booleans, complex values, ragged/nonfinite inputs and
singular matrices are rejected with ValueError. `slogdet` retains tiny valid
Jacobian values even if the ordinary determinant would underflow. Negative
determinants are valid and use their absolute magnitude. Half-scaled squares
extend the representable quadratic range. Unrepresentable transformations,
quadratics or joint sums raise OverflowError, never a partial finite score.

Copies protect against later ordinary mutation; simultaneous external mutation
while a copy is being made is not synchronized. No cross-process/model-training
publication protocol is added.

## Response migration

The existing response keys remain, with `density_semantics`,
`density_underflow` and `numeric_range_failure` added. `estimated_density`
remains the independent JOINT density, rounded to six decimals; it is a density,
not a probability or a route-average congestion score. It depends on route
length, coordinate scale and this untrained baseline. The legacy HIGH threshold
0.05 is compared in log space; it is not a calibrated congestion guarantee.
Correct normalization changes scores and classifications; callers must recheck
any previous score thresholds.

A genuine exponential underflow returns density 0 and retains its finite log
score. Display rounding can also yield zero without the underflow flag. No
artificial positive floor is added. If only exp(log-score) overflows, the finite
log remains and density is null. Unrepresentable log arithmetic returns null for
both values and UNKNOWN classification. All such responses are strict JSON-safe.
An empty prediction list gets joint identity density 1, but UNKNOWN congestion
because it has no observations. Empty scalar scoring requires the typed shape.

The original highway example already underflowed on main. Its legacy assertion
that density must be positive is corrected to assert zero, the underflow flag
and a retained negative log score. Independent SciPy covariance references and
quadrature show normalized mass; six unchanged-main controls fail.

Run from the repository root:

```sh
PYTHONPATH=backend/ml/models python -m pytest backend/ml/models/test_cnf.py backend/ml/models/test_cnf_normalization.py -q
python -m ruff check backend/ml/models/cnf_density.py backend/ml/models/test_cnf.py backend/ml/models/test_cnf_normalization.py
```

No providers, geographic calibration, deployment or production model artifact
are involved. This numerical repair is distinct from the full architecture
originally proposed in issue 10195.
