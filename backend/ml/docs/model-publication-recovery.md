# Ordinary model publication recovery

`save_model` still prepares and verifies a new immutable generation before
publication. Under its existing process-local writer owner, it now prepares
recoverable disk-backed snapshots of the prior active/previous pointers, flat
model, metadata and opaque signature sidecar. Existing absence is recorded too.
The signature/key/verification policy is unchanged.

If pointer, mirror or signing publication raises, recovery restores the exact
prior bytes or removes a newly introduced destination, and preserves the prior
deleted-reader tombstone. Readers/writers using the existing native owner wait
through recovery; an already admitted immutable reader keeps its lease. Snapshot
preparation failure never begins publication. The existing native cancellation
policy is rechecked after snapshot I/O and before serving-state mutation. A recovered failed save propagates
its original error, and the original model/history remains available for retry.
A failed first save stays unpublished; a legacy flat store stays intact.

Snapshots are disk-backed so a large existing pickle is not copied into a second
in-memory buffer. This adds disk I/O and temporary storage proportional to the
previous flat model and metadata. Normal success/recovery removes snapshots.
If recovery itself raises, `PublicationRecoveryError` signals an unconfirmed
store: snapshot backups remain beside their destinations for inspection. Stop
new writers and reconcile model pointers, metadata, mirrors and retained
`<destination>.<uuid>.tmp` backups before retrying. Do not treat that exception as
proof that either the original or candidate model is completely published.

After successful publication, generation pruning is best-effort maintenance.
A pruning failure is logged; the completed save does not falsely report a failed
training operation. Later maintenance can reclaim unreferenced generations.
Preparation failures may retain an unreferenced candidate generation, consistent
with existing storage behavior; it is not serving state.

## Native verification

The focused suite tests existing/empty/legacy stores with before/after-effect
pointer, mirror and signing failures; active-pointer acknowledgement failure;
real fitted sklearn model/metadata coherence; retry; snapshot/recovery failure;
deleted-reader state; competing native readers/publishers; unrelated-model
progress; and failed post-commit reclamation. Existing reader, mutation receipt,
fitted-consumer and core persistence suites remain in the Linux gate. The same
three legacy `TestModelIntegrity` fixtures remain explicitly excluded in that
pre-existing core gate; no new-suite tests are excluded.

This is ordinary-exception recovery for process-local cooperating operations.
It does not provide power-loss/crash atomicity, multi-process ownership or
transactional distributed storage, and performs no production-provider access.
A/B rollback ledger coordination is a separate protocol.
