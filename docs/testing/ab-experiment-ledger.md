# Durable A/B experiment ledger

Issue #17698 adds `ab_experiments` to the existing SQLAlchemy database.
New metric batches atomically create a ledger record, capture the current
production generation, bind at most one shadow generation and insert metrics.
The production identity is immutable for that test ID. Later active model
changes and process restarts do not reinterpret historical metric roles.
`_test_states` remains a compatibility attribute but is not authoritative.

## Admission and transitions

Test/request IDs are nonempty strings of at most100 characters; model versions
and metric names are at most50. A complete nonempty batch of finite numbers is
validated before any state/row mutation. Unsupported types, NaN, infinity,
float-overflow integers and a third candidate version are rejected. Native DB
failures roll back both metadata and metrics. The HTTP metrics endpoint maps
invalid batches to422 and reports `ignored_terminal` for late outcomes.

`rolled_back` and `rollback_failed` are terminal and cannot be reopened or
relabelled. A terminal transaction updates ledger status and existing metric
statuses together; later metrics are ignored. SQLite obtains `BEGIN IMMEDIATE`
before reading state because it has no row-level `SELECT FOR UPDATE`. The ledger
also fences updates by status/revision. Database constraint/concurrency errors
propagate; callers may retry failed requests rather than assume admission.
Only active experiments with both identities are eligible for shadow routing.
One finished test no longer hides other paired active tests.

## Legacy records

The old metrics table remains unchanged. Ledger records are recovered lazily.
A literal `production` version plus at most one other version proves an
unambiguous legacy pair. Real-generation rows contain no authoritative role
metadata, so the ledger marks them ambiguous instead of inventing roles from
the currently active model. Three-version legacy histories are also ambiguous.
A terminal row takes precedence over later active rows. Ambiguous histories
remain unroutable and cannot admit more metrics under that test ID; use a new
experiment ID for a new observed pair or perform an explicitly reviewed data
migration with known historical provenance.

Existing comparison directions, thresholds, production aliases and
insufficient-comparison responses remain. Existing tests that fabricated a
process cache or bypassed logging now seed the same metric observations through
actual admission; their comparison assertions are unchanged. The prior mocked
"persisted"-generation test now checks a real SQLite restart.

## Boundaries and verification

This ledger does not implement a real shadow predictor, change artifact
integrity, fence unrelated generation publication or serialize model rollback
side effects across concurrent requests. Existing generation mutation functions
remain unchanged. Tests invoke no production model rollback. PostgreSQL SQL
uses the revision fence but was not exercised by this focused SQLite suite.
Full ML service boot and repository-wide CI health are not claimed.

From the repository root, install the pinned dependencies in
`.github/workflows/ab-experiment-ledger.yml` and run:

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_ab_experiment_ledger.py backend/ml/tests/test_ab_testing_model.py backend/ml/tests/test_ab_testing_shadow_metrics.py -q
python -m ruff check backend/ml/services/ab_experiment_ledger.py backend/ml/services/ab_testing.py backend/ml/tests/test_ab_experiment_ledger.py backend/ml/tests/test_ab_testing_model.py backend/ml/tests/test_ab_testing_shadow_metrics.py
python -m ruff check backend/ml/routes/ab_testing.py --ignore DTZ005,DTZ003,BLE001
```

The tests use native SQLite, SQLAlchemy and pandas. Only the external
active-generation read is controlled. Separate service instances, thread
barriers, native transactions and a rejecting SQLite trigger exercise ownership,
races and atomic rollback without mocking database behavior. The route's
unrelated existing datetime/broad-exception lint findings are explicitly scoped.
