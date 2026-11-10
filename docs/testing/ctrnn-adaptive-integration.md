# CT-RNN adaptive telemetry integration

The public `ode_step` remains a single Euler helper. Telemetry endpoint integration now solves the same scaled field `-h + tanh(W @ h + bias)` with SciPy RK45, rtol1e-9/atol1e-12, storing only the requested endpoint. Degree scaling and final geographic bounds remain. Exact zero (and unrepresentably tiny minute durations) return the original degree values. Hidden states use the configured dimension rather than hardcoded four coordinates.

The numerical problem is admitted before solving: finite real in-range coordinates, nonnegative finite seconds, matching finite W/bias. Dynamics are copied locally; caller/model arrays are unchanged. At most20000 RHS evaluations are allowed. Nonfinite dynamics, budget exhaustion or unsuccessful/incomplete/nonfinite endpoints raise RuntimeError and return no partial coordinates.

Tests use independent fixed-step RK4 and closed-form W=0 decay, coupled fields and hidden dimensions2/3/4/7. Long-gap hemisphere/monotonicity controls catch the former600-second sign flip and boundary saturation. A genuine huge-gap solver run exercises budget exhaustion. Existing Euler/telemetry tests are included.

Run `PYTHONPATH=backend/ml python -m pytest -q backend/ml/tests/test_ctrnn_adaptive_integration.py backend/ml/tests/test_ctrnn_imputer.py`.

Local Python3.12/NumPy1.26.4/SciPy1.14.1; focused Linux Python3.11 uses the repository-declared SciPy1.11.3. SciPy is already a production dependency. No dependency manifest changes. [SciPy solve_ivp numerical contract](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.solve_ivp.html).

This fixes numerical integration of the existing untrained field. It does not establish real-route prediction accuracy, train a model, change GPS scaling, or call providers. Global service/Flutter pipelines are outside this focused gate.
