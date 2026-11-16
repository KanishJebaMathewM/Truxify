# Bounded sample-weighted model publication

Issue #17702 repairs the existing standalone `FederatedAveragingServer` in
`federated/fl_server.py`. The separate `robust_aggregate` median helper and
TensorFlow/Fernet/DP round server are unchanged. No mounted serving caller was
found for this sample-weighted class; this is not an encrypted transport or
distributed round implementation.

## Numerical and ownership contract

Admit the complete client batch before computing or publishing a replacement:

- Fixed integer model width1..4096; at most256 clients and1,048,576 scalar updates.
- Exact-width one-dimensional real numeric vectors, owned as finite binary64.
  No scalar broadcasting, booleans, object/string/complex arrays or nonfinite
  values. Values unrepresentable in binary64 are rejected.
- Positive integer sample counts, including native NumPy integers, with at most
  4096 bits. No negative/zero/fractional/boolean counts. The count bit cap bounds
  integer work; this component does not attest counts against client datasets.

Every finite binary64 coordinate is an integer multiple of2^-1074. The server
accumulates these integer units multiplied by exact sample counts, then converts
one rational quotient per coordinate to binary64. This avoids overflow in a
finite convex mean, early sample-share underflow, cancellation loss and client
ordering dependence. It trades vectorized throughput for wide-range reliable
arithmetic; no throughput improvement is claimed. The resource limits bound
this Python integer work and owned array memory.

Only a fully computed finite model is published, under a process-local lock.
The legacy `global_weights` getter/setter remain usable, with complete admission
and defensive copies. Inputs, returned aggregates, read snapshots and empty
batch results never expose writable aliases to retained state. Concurrent
publications replace a whole model; there is no client/round deduplication or
cross-process arbitration. Callers must keep their input buffers stable while
admission copies them. The model width is immutable for a server instance.

## Verification

```sh
PYTHONPATH=backend/ml:backend/ml/federated python -m pytest backend/ml/tests/test_fedavg_publication.py backend/ml/tests/test_fl_server.py backend/ml/tests/test_federated_stable_projection.py backend/ml/federated/test_fedavg.py -q
python -m ruff check backend/ml/federated/fl_server.py backend/ml/tests/test_fedavg_publication.py
```

The focused Linux workflow pins NumPy1.26.4 and runs actual aggregation without
numerical mocks. An independent 2500-digit Decimal oracle covers binary64
extremes, subnormals, cancellation, uneven sample counts and80 seeded vector
batches. Existing sample-weighted/median/projection tests are included.
Native thread readers verify complete model snapshots. Invalid later clients
must preserve the old model; caller mutations must not change it. No neural
training, provider, Redis or vehicle control is exercised.
