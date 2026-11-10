# Spatial indexing for packing stop sequences

The packing model retains its nearest-neighbor delivery heuristic from the
supplied depot. It uses the original scalar scan for fewer than 512 distinct
packed indices. Larger inputs lazily import SciPy's KDTree, already declared in
ML requirements; unavailable SciPy falls back to the scalar scan.

## Spherical shortlist

Each valid coordinate becomes a three-dimensional unit-sphere point:
`(cos(lat) cos(lng), cos(lat) sin(lng), sin(lat))`. Euclidean chord distance is
monotonic with great-circle distance on the sphere, avoiding planar longitude
errors at the antimeridian and poles.

The tree contains remaining and recently visited stops. Queries expand their
neighbor count until they find a live index. A radius query includes that nearest
chord distance plus a conservative `2e-12` unit-sphere margin, then the original
scalar Haversine distance and original package index select the winner. This
keeps coincident and nearby ties from depending on tree traversal order. Near
antipodes (nearest chord at least 1.9999), the full scalar comparison is used.

The tree rebuilds when at least half its indexed points have been visited. The
last 32 stops use the simple scalar scan. Points, indices, tree storage and the
largest temporary shortlist remain linear; no all-pairs distance matrix exists.

The address-count wrapper now forwards `route_start` as the fourth argument,
matching the existing model and endpoint contract. Before this prerequisite fix,
the wrapper rejected the public four-argument call with `TypeError`.

## Measurements and limits

Deterministic separated-stop fixtures count actual scalar distance calls:

| Stops | Original scan | Indexed path |
| --- | ---: | ---: |
| 200 | 20,100 | 20,100 (small path) |
| 400 | 80,200 | 80,200 (small path) |
| 800 | 320,400 | 1,296 |
| 1,600 | 1,280,800 | 2,096 |

One local warmed measurement was about 95 ms versus 8 ms for 800 stops and
376 ms versus 15 ms for 1,600. These are illustrative, not latency guarantees.
The first scientific import took about 0.35 seconds in the same environment,
so a cold isolated call can be slower. Timing is not a CI assertion.

Repeated/coincident stops can require large tie shortlists and retain quadratic
worst-case comparison work; tree searches themselves also have pathological
cases. The scalar fallback remains quadratic. This optimizes ordinary separated
large inputs, not packing geometry, weight/orientation policy, road distances,
time windows, or globally optimal routing. Equivalence is tested against the
original full-scan floating-point rule; the margin is a numerical safeguard,
not a universal proof covering every possible floating-point pathology.

## Verification

```sh
PYTHONPATH=backend/ml python -m pytest backend/ml/tests/test_bin_packing_spatial_sequence.py backend/ml/tests/test_bin_packing_algo.py -q
```

The 66-test group includes 32 seeded local/global full-scan oracles, seams/poles,
near ties/antipodes, repeated locations and indices, sparse subsets, input
immutability, fallback and validation checks, deterministic work bounds, the
real public packing entry point, and existing packing algorithm tests. Legacy
three-argument packing tests predate the required depot contract and remain
outside this group; no full heavy ML app/provider integration is claimed.

The index uses SciPy's documented [nearest-neighbor query](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.KDTree.query.html)
and [radius query](https://docs.scipy.org/doc/scipy/reference/generated/scipy.spatial.KDTree.query_ball_point.html)
with `eps=0`, Euclidean distance, and one worker.
