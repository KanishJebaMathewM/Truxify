# A/B rollback ownership

The durable ledger freezes the production/shadow generation identities. A rollback
now admits that exact pair under the existing process-local model writer owner,
then reserves the active ledger revision within its native transaction. Comparison
reads use that same transaction. A different active/previous pair is rejected and
marked `rollback_failed` without changing model files.

The owner remains held through pointer publication, the signed flat compatibility
mirror, metric/experiment terminal updates and ledger commit. A second request
observes terminal state; it cannot swap the pair back. Readers and publishers using
the existing model owner wait through publication or ordinary failure recovery.
Already admitted immutable readers retain their existing generation leases.

Ordinary storage failures restore the original pointers and signed flat mirror
before recording `rollback_failed`. A rejected ledger publication instead restores
the original pair and leaves the experiment active for retry. If commit succeeds
but its acknowledgement raises, a fresh native session checks the exact terminal
revision/status/pair receipt. A confirmed receipt retains the restored generation;
a missing receipt compensates the files and propagates the failure. An unreadable
receipt raises `RollbackOutcomeUnknown`, preserves the unconfirmed file outcome,
and requires storage/ledger reconciliation. It never reports success or guesses
compensation. A failure during recovery raises `RollbackRecoveryError`; it does
not claim preserved artifacts. Inspect the ledger and generation pointers before
retrying either unknown/recovery-failed outcome.

Successful responses return the generation restored by this operation, rather
than rereading a pointer after another publisher can advance it. Cache invalidation
occurs after releasing the model owner. The synchronous rollback HTTP route runs
on FastAPI's worker pool, avoiding native storage waits on the event loop.

## Verification

The native suite uses SQLite, actual local signed pickle artifacts, independent
service instances, native SQL rejection, concurrent readers/publishers, and
controlled filesystem/commit acknowledgement failures. Existing metric admission,
comparison, legacy ledger and HTTP contracts remain covered.

```sh
PYTHONPATH=backend/ml python -m pytest \
  backend/ml/tests/test_ab_rollback_ownership.py \
  backend/ml/tests/test_ab_experiment_ledger.py \
  backend/ml/tests/test_ab_testing_model.py \
  backend/ml/tests/test_ab_testing_shadow_metrics.py -q
```

This protocol handles process-local cooperating writers and ordinary exceptions.
It does not provide a crash-atomic database/filesystem transaction or coordinate
independent OS processes, arbitrary reentrant publishers, external storage writers,
or production controls. PostgreSQL behavior is not claimed as natively verified.
Artifact verification/key policy, prediction math, database schema and promotion
recommendations are unchanged.
