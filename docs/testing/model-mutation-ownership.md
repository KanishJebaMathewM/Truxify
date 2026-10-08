# Native generation mutation and maintenance ownership

Four native private-filesystem controls on current main showed that publication can return another writer's generation, detailed rollback can report a later publication as its restored model, temporary cleanup can delete an open serialization file, and explicit backup metadata retains the source generation instead of the backup identity.

The model mutation lock is now reentrant. `publish_model` owns save through its generation result; `rollback_model` owns restoration through its matching generation/metadata response. The public save/publish/restore result types stay unchanged. Reader reservations continue to release the lock while immutable artifacts are read. Different model names retain independent mutation locks.

Temporary maintenance holds the corresponding mutation lock, so a live serializer finishes before cleanup inspects its temporary paths. Exact destination basenames and generated32-hex UUID suffixes identify owned temporary files, preventing prefix collisions with another model or deletion of unrelated scratch files. Generation model/meta temporaries and flat mirrors/pointer temporaries are covered. Explicit backup metadata binds the backup generation and retains `backup_from_generation` provenance.

## Native verification

The existing `.github/workflows/ml-model-reader-lifetimes.yml` now includes mutation, reader and real fitted-prediction consumer tests, plus core persistence compatibility. Actual native files/signature fixtures, serialization, fsync/publication and threads run in isolated temporary stores. The tests pause only real operation boundaries, not the filesystem implementation.

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_model_mutation_ownership.py backend/ml/tests/test_model_reader_lifetimes.py backend/ml/tests/test_model_snapshot_consumers.py -q
```

31 local tests pass. Core persistence adds42 passing tests with3 existing `TestModelIntegrity` cases explicitly deselected; full unchanged-main and changed-source runs fail those same3 legacy fixture cases. The complete focused local gate passes73 tests with3 deselections. Full new-source Ruff and scoped legacy base analysis pass; four existing legacy rule families remain explicitly ignored.

Private fixtures set a clearly synthetic artifact key/signature directory; no production artifact or credential is read. Signature/integrity policy itself is outside this change.

## Boundaries

Outcomes identify this operation's result at its completion; another writer can subsequently replace active state. Coordination is process-local, not an inter-process storage lock or crash-atomic multi-pointer transaction. Existing signature policy and cancellation behavior remain intact. Cleanup is serialized behind active same-model mutations and can wait for slow serialization; unrelated model publication continues. Unrecognized temporary names remain for manual inspection. No provider, deployment or production filesystem is involved.
