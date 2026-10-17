# Extreme-point support admission

The Python `BinPacking3D` heuristic now admits a complete finite cargo batch
before sorting/placement. Positive dimensions, nonnegative weights and actual
boolean flags are copied into private observations; caller dictionaries are not
changed. Default IDs use input indices, so rejecting/reordering cargo cannot
reuse an ID. Container dimensions/payload and representable volume are validated.

Every candidate must be contained, disjoint from admitted boxes, and on the
floor or completely covered by eligible coplanar top faces. A sweep over exact
x-slabs merges clipped y-intervals: adjacent supporting tiles are accepted,
while overhangs and even tiny uncovered gaps are rejected. Fragile/non-stackable
columns preserve their existing stacking prohibition. Returned positions and
dimensions retain their admitted precision; three-decimal rounding no longer
changes geometry used by later collision checks.

Fraction arithmetic proves bounds, overlap and support in the exact rational
values represented by output binary floats. Proposed rounded contacts that
cannot be proved are conservatively rejected. This may leave additional cargo
unpacked; it does not assert optimal packing. Exact products preserve the
legacy weight-times-volume sorting rule without overflow. Normalized exact
volume and weight moments avoid overflowing intermediate utilization/CoG sums.
Summary display rounding remains separate from placement geometry.

These checks add rational arithmetic and support-union work to the heuristic.
The support sweep uses at most two x-boundaries per supporting box and scans
its clipped intervals for each slab; it is not a real-time loading optimizer.
The model does not certify load-bearing strength, friction, securement, axle
loads or real vehicle safety; the pre-existing CoG flag is only a heuristic.
The C/vector matcher and shelf-based packer are separate, unchanged engines.

Native tests use an independent exact containment/non-overlap and cell-midpoint
support oracle on emitted boxes, joint-tile/gap/fragile cases, rotation, precision,
complete invalid observations, caller ownership, grid packing, extreme finite
weights and strict JSON summaries. No providers, hardware or real vehicles run.
