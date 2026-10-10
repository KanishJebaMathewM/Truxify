# Collaborative recommendation payloads

Load and training admit a complete aligned candidate before serving publication.
Training owns its input IDs and interaction matrices before native SVD, then
admits reconstructed scores and popularity before persistence. Invalid refresh,
fit candidate or persistence retains the previous serving generation; invalid
candidates never reach training persistence. Missing fields retain their previous
`KeyError` behavior; malformed values raise `ValueError` (non-dict payloads raise
`TypeError`). Existing auto-train fallback for absent artifacts is preserved.

User/load/truck IDs are unique, nonempty strings of at most256 characters, at
most10,000 per collection. Matrix geometry follows those complete ID lists;
load plus truck interaction geometry admits at most2,000,000 cells. Native real
NumPy matrices become owned finite float64 arrays. Zero is missing, positive
ratings lie in(0,5]; reconstruction scores may fall outside that range and retain
existing public clipping. Popularity is a complete integer index permutation in
descending observed-total order; existing tie ordering is retained.

Published numerical arrays are owned read-only copies; ID lists are copied.
Changing the original storage/source payload cannot mutate current or captured
recommendations. Existing lifecycle/state locks and warm scoring remain; captured
old requests may finish while a new candidate prepares or persists. Booking
exclusions, cold fallback, count validation, missing-rating centering and native
SVD formulas remain unchanged. Zero-user/zero-item candidates are admitted with
aligned empty geometry; outputs remain finite strict-JSON values.

These are invocation/ownership bounds, not calibrated latency or relevance
metrics. Arrays require extra copies during input preparation and candidate
publication. Dense SVD and temporary memory cost still depend on admitted shape;
no full memory/time guarantee is claimed. This validates native array geometry
and finite values, not proof that a loaded reconstruction came from a particular
historical SVD run. Deliberate direct mutation of model attributes, cross-process
refresh, external code rewriting internal candidates, provider/bootstrap/security
changes, signed-artifact/reader-lease protocols and real-data recommendation quality
are outside this repair. The existing synthetic-data training remains a placeholder.
