# Cold-chain numerical aggregation

The Python cold-chain service retains its existing equal-observation Arrhenius
formula with `DELTA_H_OVER_R = 10000`, two-decimal display values, and business
breach thresholds. The formula is described in equation 1 of
[Jenkins, Cancel and Layloff (2022)](https://pmc.ncbi.nlm.nih.gov/articles/PMC8842539/).
This reference supports the formula; it does not certify this implementation or
its activation constant for any particular cargo or pharmaceutical product.

## Arithmetic

Cold windows use max-shifted log-mean-exp, avoiding exponential underflow.
Very hot windows use the mean of `expm1` deficits and `log1p`, preserving
information when ordinary exponentials round to one. The exact MKT lies between
sample temperatures; the final Kelvin calculation is bounded to this range for
floating-point drift. Public temperatures retain their existing two-decimal
rounding. Shock RMS divides by the peak before squaring and restores scale after
the square root, preventing overflow. Runtime arithmetic is linear in samples.

## Admission and migration

Every temperature must be a finite numeric value strictly above absolute zero.
Booleans, strings, missing values, infinities and NaNs reject the complete
window. Dropping individual readings would change the equal-observation meaning.
Every shock must likewise be finite numeric data. An empty MKT request retains
`null`; an empty cargo assessment now returns a client error instead of NORMAL.
An empty shock window retains zero metrics. Direct invalid service calls raise
ValueError; the real router returns HTTP 400 or schema-level 422.

Policy bounds must be finite physical temperatures with minimum <= maximum.
Sampling interval must be positive, excursion allowance nonnegative, and door
count a nonnegative integer. Excursion-duration overflow rejects evaluation.
An explicit zero allowance is retained; nullable optional request values keep
legacy defaults. JSON numeric strings and booleans no longer coerce to readings.
Clients must send genuine numeric observations and handle invalid-window errors.

## Verification and limits

The focused suite uses actual Python service and FastAPI router sources. Its
independent 400-digit Decimal reference evaluates the original untransformed
formula, including cold underflow and near-one inputs. Baseline controls on main
fail for cold/hot MKT, finite RMS and zero allowance. Runtime uses Python math;
NumPy remains a baseline-reproduction dependency only.

The test app mounts the actual router while bypassing unrelated eager imports in
services.__init__; it does not claim the complete ML service boots. The existing
route registry lists this router. There are no real sensors, providers, escrow
writes or deployment actions. Extreme finite inputs are numeric robustness tests,
not supported sensor ranges. Two-decimal display values and the existing
classification rules remain approximations. This change does not add irregular
interval weighting, product-specific stability analysis or regulatory guarantees.

Run from the repository root:

```sh
python -m pytest backend/ml/tests/test_cold_chain_numerics.py -q
python -m ruff check backend/ml/services/cold_chain_anomaly.py backend/ml/routes/cold_chain_routes.py backend/ml/tests/test_cold_chain_numerics.py
```
