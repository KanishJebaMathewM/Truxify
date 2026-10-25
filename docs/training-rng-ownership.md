# Invocation-owned synthetic training randomness

The mounted ETA, demand, profit, collaborative and trust data generators each
create a local `numpy.random.RandomState(42)`. This intentionally keeps the
legacy MT19937 stream and draw ordering instead of migrating to `default_rng`,
which would change existing seed42 synthetic arrays. Calls do not reseed or
consume NumPy's process-global random state.

Each invocation owns its stream: simultaneous calls to the same or different
models and unrelated global draws cannot interfere. No cross-model training
mutex is needed. Existing fit seeds, per-model serving/publication locks,
endpoints, artifact formats and production dependencies remain unchanged.
Synthetic data remains a documented placeholder and is not market evidence;
this fix promises reproducibility, not accuracy, fairness or calibration.

From the repository root:

```sh
python -m pip install -r tools/training-rng-tests/requirements.txt
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_training_rng_ownership.py -q
```

The serial compatibility oracle freezes the five original main06da794fd
function bodies, with only function names changed. It deliberately retains
global draws; tests save/restore the global stream around that oracle. Exact
array comparison is against the same native NumPy runtime, rather than hashes
that can differ across CPU math implementations. The native thread tests
pause after a real first draw and interleave another real generator or global
draws. No estimator fitting, model store, production database or provider is
used. Existing unrelated imported-module escape warnings are not introduced
by these generator changes.
