# Shelf packing numeric geometry

The Python shelf packer admits a private, complete numeric observation before
sorting or placing packages. Dimensions and truck mass capacity must be positive,
finite real values representable as floats; package mass may be zero. Booleans,
missing values, negative mass and nonfinite values raise `ValueError` before any
shelf placement. Original dictionaries remain untouched.

All volume ordering, accumulated mass, and utilization arithmetic uses exact
fractions of the admitted binary floats. This avoids product overflow/underflow
and losing small positive mass in a rounded accumulated total. Volume utilization
is converted to a float only after taking the bounded dimensionless ratio.

Placement compares coordinate plus dimension exactly. Occupied cursors round
upward to the next representable float when necessary. New rows and shelves start
above the actual emitted preceding geometry. Coordinates are emitted without the
old four-decimal truncation; original dimensions and selected orientation define
each output box. This intentionally changes some boundary fits and small gaps,
volume ordering near rounded ties, and invalid-input behavior. Conservative gaps
can reject a mathematically fitting layout that has no safe public float cursor.

Six orientation order, first fitting shelf order, frozen lower-shelf clearance
and the ordered feasibility index are retained. The index remains a conservative
shortlist: actual exact placement is authoritative. It retains its previous
size/scale eligibility and false-positive behavior. Zero mass uses the scan.
Fraction arithmetic adds CPU cost; this is a correctness repair, not a blanket
speed improvement or optimal packing claim. The linear scan oracle tests index
selection independently; separate Fraction witnesses reconstruct original-input
boxes and verify containment, disjointness, mass and utilization.

This heuristic does not certify cargo support, stability, axle loads, real vehicle
safety or delivery-stop optimality. Extreme dimensions are numeric controls, not
realistic vehicle specifications. Node consolidation, C++ matching, the separate
extreme-point packer and stop sequencing are outside this repair.
