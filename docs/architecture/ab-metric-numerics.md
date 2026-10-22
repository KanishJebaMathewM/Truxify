# Finite A/B metric comparison

Evaluation uses the existing authoritative experiment pair and native ledger
transaction. Role-specific observations are admitted as complete finite binary64
groups. A missing or invalid group is not replaced with zero or a selectively
filtered mean. Invalid legacy observations remain in the database and are
reported; they never become votes.

## Arithmetic and decisions

Binary64 values have power-of-two denominators. Exact binary-rational
accumulation avoids both naive sum overflow and divide-first/scaled cancellation
or subnormal loss. A role mean is rounded once back to binary64. Improvement
uses an exact signed delta/ratio before its final display conversion, so a valid
-1e308 to1e308 comparison produces200%, not infinity.

A mathematically valid percentage larger than binary64 can display is `null`
with `improvement_status: outside_float_range`. The finite observed pair remains
eligible for the decision; it is not discarded because a display field cannot
represent its ratio. No capped/fabricated percentage or nonstandard JSON NaN/
infinity is emitted. Direct numerical helpers reject boolean, nonnumeric and
nonfinite inputs; thresholds must be finite nonnegative real values.

The legacy positive-baseline gates remain: higher metrics compare shadow to
production×threshold with `>`, lower metrics use `<`. For signed baselines, the
same margin is translated using the baseline's absolute magnitude. The boundary
is rounded once, retaining native strict equality/tie behavior. If a boundary is
outside binary64, its exact comparison still works without displaying infinity.
Existing polarity keywords, strict-majority rule and ordinary positive behavior
are preserved; this does not silently impose a new promotion policy. In
particular, the historical `shadow_better` name still reflects those existing
direction-specific threshold gates, not a new guarantee of positive improvement.

Zero baselines retain the historical absolute-delta×100 display, explicitly marked
`improvement_basis: absolute_delta_x100`; that value is not a relative percentage.
Normal finite nonzero comparison dictionaries retain their original three fields.
Only missing/invalid/out-of-range observations add diagnostic fields. Evaluation
and `is_shadow_better` share the same finite-pair eligibility and denominator.

## HTTP prerequisite and boundaries

Current main's A/B router contains an unused legacy free-function registry block
with JavaScript conditional syntax and undefined registry dependencies. Removing
only that block restores imports for the actual service-bound HTTP consumers.
The bound prediction/evaluation/rollback paths and their model-family selection
are unchanged. This does not solve the separate ETA-versus-DEMAND routing policy.

Native ledger identities, restart/terminal rules, metric admission, rollback
snapshot ownership, artifact generation/signature policy and real model selection
are preserved. No schema migration, provider, production rollback, physical model
quality, statistical significance or distributed atomicity claim is introduced.
Exact accumulation does more Python integer work than a vectorized float mean;
large histories are still materialized under the existing transaction. No new
pagination/resource limit or universal runtime/memory guarantee is claimed.

## Verification

Actual SQLite/SQLAlchemy and the restored FastAPI router exercise JSON output,
legacy corrupt/missing rows, role identity, restarts and native local signed model
rollback consumers. Independent high-precision Decimal references cover the full
binary64 exponent range and cancellation; ordinary gate controls use the original
native positive-baseline comparisons. No numerical operator, database, model
lifecycle or JSON implementation is replaced by a fake. The external production
generation identity is controlled where an evaluation fixture needs declared roles;
no provider is contacted and no production generation is changed.
