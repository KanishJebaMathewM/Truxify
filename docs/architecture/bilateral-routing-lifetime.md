# Bilateral road matrix lifetime

The mounted `/match/bilateral` consumer tiles driver-source/load-destination
coordinates into at most 100 coordinates per OSRM table request. It restores
cells to their original indices and does not change the assignment objective.
A 60×60 batch uses four bounded tables instead of a single 120-coordinate request.
Asymmetric cases use the available coordinate budget for the larger side.

One optional matrix has at most 1,000,000 cells; larger requests retain the
existing geometric fallback without allocating a road matrix or contacting
OSRM. This cap applies only to optional routing, not solver/request capacity.

A successful tile's explicit `null` denotes an unreachable pair. Invalid numeric
cells remain infeasible (including negative, nonfinite, boolean or oversized
integers). A failed transport/shape/status tile uses an internal unknown marker,
so only those cells use the existing geometric fallback. Successful road cells
survive partial failure and keep their original deadline behavior. All unknown
returns the legacy `None` matrix result. OSRM disable configuration is preserved.

## Resource limits

Each matrix has one monotonic three-second caller budget including all tiles.
Four process-local native provider slots have no executor queue. Native future
settlement releases its captured admission owner; caller timeout is not proof
that Requests/socket/body work finished. A stuck provider keeps its slot and
new optional lookups fall back promptly. Requests' native connect/read timeout
is capped at 1.5 seconds and the remaining caller budget; it cannot kill arbitrary
Python code or guarantee instantaneous socket teardown. There is no request
cancellation, cross-process provider quota or exactly-once external effect.

Response bodies are streamed and capped at 256 KiB after decompression. Declared
oversized bodies are rejected before reading; chunk reads also enforce the cap
and monotonic deadline. Every acquired response is closed in finally. Native
JSON parsing or socket reads can outlive the caller; their admission remains
owned until actual completion. ThreadPoolExecutor has process lifetime and is
joined by Python's normal interpreter shutdown, which can still wait for a
stuck native worker. No stronger shutdown guarantee is claimed.

## Verification

```sh
python -m pip install -r tools/bilateral-routing-tests/requirements.txt
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_bilateral_routing_lifetime.py backend/ml/tests/test_bilateral_matcher_algo.py -q
ruff check backend/ml/tests/test_bilateral_routing_lifetime.py
ruff check --select E9,F63,F7,F82 backend/ml/app/models/bilateral_matcher.py backend/ml/tests/test_bilateral_matcher_algo.py
```

Native loopback HTTP tests execute actual Requests, geographic/deadline costs
and the actual SciPy matcher. They cover rectangular index reconstruction,
100-coordinate limits, partial failure versus unreachable, total trickle-body
budget, four unfinished native calls after caller expiry, allocation/byte caps
and response cleanup. Existing mocked provider fixtures now expose the bounded
streaming interface; their original expected deadline/unreachable behavior is
unchanged. Tests route exclusively to loopback or controlled response fixtures;
no production provider, model fit, deployment or financial action is needed.
The focused gate does not claim the entire monorepo is green.
