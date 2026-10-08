# Model-level cargo geometry

The newer models/BinPackingEngine now admits the complete request, orders boxes by decreasing volume, and searches a deterministic extreme-point frontier (z/y/x priority) across all six axis-aligned orientations. Every placement must fit bounds, avoid all existing box interiors, remain within total mass, and have a fully supported footprint. Supporting coplanar top faces are clipped and their union tested using an x-strip/y-interval coverage sweep. Floor placements need no support.

This greedy heuristic is not a feasibility oracle or globally optimal packing algorithm. It can reject loads another arrangement could fit. Candidate/orientation collision and support searches are not a new whole-packer complexity guarantee. Geometry is finite representable float arithmetic with conservative exact comparisons, not an epsilon overlap allowance. Dimensions/volumes must be positive and representable; weight/capacity are finite nonnegative values and IDs unique nonempty strings.

Only after a complete private plan are Item.position/rotation/placed_dimensions published. Valid repacks clear rejected Items; invalid requests preserve prior fields. Rotation indices follow itertools.permutations(length,width,height) order: LWH,LHW,WLH,WHL,HLW,HWL. Original dimensions remain; additive result placements exposes selected position/dimensions/rotation. Legacy success/packed/unpacked/weight/utilization fields remain.

The existing midpoint-based axle summary remains approximate. Full-footprint support does not certify structural load-bearing, center of gravity, axle regulations, LIFO ordering or actual truck safety. Separate app/models shelf packer and Node consolidation are unchanged.

Native tests independently enumerate integer voxel occupancy and floor support, verify mass/orientation/bounds, full grids, all six rotations, seeded heterogeneous boxes, union support/gaps, repacks and invalid full-request immutability.

`PYTHONPATH=.:backend/ml python -m pytest -q backend/ml/tests/test_cargo_geometry.py backend/ml/test/unit/test_bin_packing.py`

34PASS (31new+3existing). The duplicate legacy test_bin_packin.py cannot collect on unchanged main because its final assertion ends in c1 followed by111111. It is outside the focused gate and remains untouched; no broad test-suite success is claimed.
