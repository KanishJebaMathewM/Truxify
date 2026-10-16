# Signed driver-profit prediction intervals

The net-profit target includes losses. Bounds therefore retain their sign and
include the point estimate; zero-clamping a loss lower bound inverted the old
interval. Both legacy and newly calibrated results reject nonfinite endpoint
arithmetic instead of emitting misleading JSON.

New training splits the deterministic synthetic dataset into 60% model fitting,
20% calibration and 20% evaluation, with no overlapping rows. Calibration uses
absolute held-out residuals and the order statistic at `ceil((n+1)*19/20)`.
The rank is computed with integer arithmetic, without interpolated quantiles.
If that rank exceeds the number of observations, no finite calibrated bound is
claimed. The normal 2000-row dataset has 400 calibration rows and rank381.

The method is split-conformal residual calibration as described in
[Angelopoulos and Bates](https://arxiv.org/abs/2107.07511). Its nominal95%
marginal coverage relies on exchangeability of calibration and future examples;
it is not conditional coverage per trip. The current synthetic generator is
not operational freight evidence. Distribution shift, real losses and model
accuracy still need independent validation. The API labels `data_provenance`
`synthetic`; it does not advertise certified real-world coverage.

Calibration metadata is saved with the existing model-generation metadata,
validated before loaded serving state is replaced, and captured with that model
and its feature-domain bounds under the state lock. Failed training/publication
or invalid metadata retain the complete older serving generation. Existing
paired immutable snapshot loading and artifact signature policy are preserved.

Legacy generations without calibration retain signed stage-heuristic bands,
explicitly labeled `legacy_stage_heuristic` with `coverage: null`; tree increments
are not independent samples of prediction error. New calibrated generations do
not need `staged_predict`. The existing `confidence_interval` field is retained
for compatibility; additive `interval_calibration` explains its semantics and
is included in the mounted endpoint response schema.

Native tests cover independently sorted ranks, exhaustive exchangeable rank
positions, invalid/insufficient windows, negative and positive bounds, real
sklearn fitting and signed file reload, row-disjointness, rejected publication,
invalid generation metadata, and replacement during native inference. All
artifacts/signatures are temporary test files; no production providers run.
