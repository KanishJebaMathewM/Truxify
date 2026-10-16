# Python OSRM result admission

The Python client consumed by `app/models/mid_trip_reoptimiser.py` admits a
complete owned list/tuple of geographic coordinate pairs before making requests
or building its quadratic fallback. Coordinates must be finite real numbers in
latitude [-90,90] and longitude [-180,180]; booleans and numeric strings are
invalid. Empty tables retain `([], [])`. Tables exceeding 100 locations raise
`ValueError` before HTTP or allocation. Type/schema errors raise `TypeError` or
`ValueError`; callers must handle these input errors rather than assume fallback.
The bound is client policy, not a promise about a server's configured capacity.

A road response must be a JSON object with `code: Ok`. Both tables must be exact
NxN row-major arrays; every non-null distance and duration must be a finite,
nonnegative JSON number. Both complete tables are validated before returning
any result. Direction/order and metres→kilometres / seconds→minutes are retained.
Null cells continue to map to positive infinity individually; they are not
replaced with invented road connections. Route results use the same metric
contract. Numeric strings and booleans are rejected, while legitimate zero is
preserved. Result lists are newly allocated.

Service/HTTP/malformed-result failures retain the existing whole-result
Haversine fallback and 40 km/h duration estimate. This remains a geometric
estimate; it does not establish road reachability, live traffic, or an accurate
pickup promise. This PR does not change that existing public tuple/list API to
carry provenance. It does not add retries, a total body deadline, caching, or
change configured endpoint/network authority. Haversine roundoff is clamped to
its mathematical [0,1] domain at antipodal coordinates. Configured request timeout
remains the existing requests timeout, not a total request wall-clock guarantee.

Run Python3.12 with requests, pytest and Ruff:

```sh
PYTHONPATH=backend/ml python -m pytest -q \
  backend/ml/tests/test_osrm_protocol_integrity.py \
  backend/ml/tests/test_mid_trip_road_eta.py \
  backend/ml/tests/test_mid_trip_deadline_insertion.py \
  backend/ml/tests/test_mid_trip_insertion_complexity.py
python -m ruff check backend/ml/utils/osrm_client.py \
  backend/ml/tests/test_osrm_protocol_integrity.py
```

45 new tests exercise real requests to a loopback HTTP server, without mocking
transport or routing mathematics. An independent Cartesian cross/dot central-angle
reference checks fallback geometry. The 73 existing consumer tests use their
existing matrix fixtures; they are compatibility evidence, not live OSRM evidence.
Combined 118 tests and full changed-file lint pass locally. Unchanged-main
selected protocol controls produce 18 failures / 4 passes. No production OSRM,
map download, real trip changes or full-service boot are required or claimed.

Contract reference: [official OSRM HTTP API](https://project-osrm.org/docs/v5.24.0/api/).
