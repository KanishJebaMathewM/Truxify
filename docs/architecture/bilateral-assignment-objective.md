# Accepted bilateral assignment objective

Bilateral matching accepts disjoint load-driver pairs whose raw cost is below200.
The optimizer now chooses among exactly those pairs and unmatched alternatives,
maximizing total unrounded gain `200 - pair_cost`. This is the accepted cost
objective, not a guarantee of maximum cardinality or maximum sum of rounded,
clamped display scores. Distance, capacity, dimensions, deadline, destination
preference and rating costs stay in the existing calculation.

The previous square padding charged200 for each unmatched endpoint. Leaving a
load and driver unmatched thus cost400, while the result later discarded pairs
at cost200 or above. That disagreement let discarded pairs consume endpoints
and change which valid pair survived. The current geographic regression yields
costs `[117.8666,275.0221;168.9422,1000326.0977]`. The old result kept the168.9422
pair; the corrected result keeps117.8666, improving its displayed score from
0.1553 to0.4107 without changing input constraints.

## Rectangular representation

Orient the smaller partition as rows. Real columns represent the other partition;
add one dummy column per row at cost200. Each row can therefore go unmatched,
while unmatched columns incur no extra penalty. This gives the same objective
for either orientation. Banned and nonfinite real edges are infinity; finite
dummies guarantee a feasible assignment. Returned indices are mapped back to
load/driver coordinates and sorted by load index.

For `n`loads and `m`drivers, the augmented matrix has
`min(n,m) * (n+m)`float64 elements, versus the old `(n+m)^2`.
The separate `n*m`real cost matrix and pairwise cost/routing construction remain.
This change is not a total memory cap or a measured end-to-end latency claim.
For2loads/1000drivers (and the reverse), solver input now allocates16,032bytes
instead of8,032,032bytes. Tests inspect actual solver input shape and nbytes.

## Verification

The new suite compares280 seeded small matrices in seven shapes against an
independent exhaustive partial-injection oracle. It also checks both orientations,
negative rating costs, exact cutoff, poor/infeasible edges, ties, empty partitions,
unique indices, deterministic load ordering and the actual geographic regression.
The15 existing algorithm/unmatched tests remain green:34 tests across three
suites pass with both SciPy1.11.3 (repository pin)/NumPy1.26.4 and
SciPy1.17.1/NumPy2.5.3. No external OSRM or ML training is used. Dedicated routing
fixtures opt in to controlled OSRM responses in the existing algorithm suite.

The larger FastAPI/model-dependency stack is not required for these actual
matcher and solver tests; no full ML service/deployment claim is made.
