# Demand generation decisions

The forecast consumer uses the existing immutable `load_model_snapshot` to
admit the model and its provenance together. A concurrent publisher cannot
make a synthetic-tagged artifact appear allowed by attaching a successor's
metadata, or make an allowed artifact appear synthetic. The existing source
policy (including `module_trained` compatibility) is preserved; this repair
does not turn the synthetic trainer into a real-booking data pipeline.

Training fits and evaluates privately. Its publication decision then shares
the existing model-scoped native writer with `save_model`, rollback and direct
artifact publishers. Current metric observation, threshold admission, optional
save, cache invalidation and returned generation capture occur under that
owner. A writer that wins before admission is considered in the decision; a
writer that arrives afterward waits and may publish after that decision.
The reported version describes the completed operation, not a promise that
no later writer will ever replace it.

Current and candidate MAE must be finite nonnegative observations. An existing
artifact without readable metadata is not treated as an absent model. Missing
legacy MAE retains the existing first-comparison compatibility policy. The
improvement threshold is compared as exact rational products of admitted
binary float values rather than dividing potentially extreme differences.
A perfect zero-MAE generation cannot improve by a positive relative threshold;
a configured zero threshold retains explicit exact-tie eligibility.

Rollback holds the same writer through restore, invalidation and result
capture. A competing publisher cannot supply the restored operation's metrics
or version. Native lock order is demand lifecycle -> artifact writer -> short
cache state. Warm cache reads do not acquire the lifecycle owner, and cold
load epoch ownership is preserved; a reset revokes earlier cold-load publication.
An admitted warm cache can still represent an older coherent generation until
normal invalidation. This is not cross-process locking, crash recovery, model
quality certification, or a redesign of the existing artifact publication API.

Native tests use actual sklearn estimators/scalers, signed temporary artifact
files and competing Python threads. They check provenance in both directions,
publication/rollback decision ordering, metric admission, independent exact
threshold boundaries, save/cancellation failures and existing cache lifecycle.
No database, external data provider, heatmap engine or production model runs.
