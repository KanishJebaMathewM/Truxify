# Ordered shelf feasibility search

`_pack_packages` retains volume-decreasing first-fit shelf packing. At 128 or
more packages with positive finite built-in numeric dimensions/weights and truck
values no larger than 2**53, it uses `ShelfFitIndex` to prune shelf searches.
Smaller or unsupported legacy numeric inputs keep the scan. No optimal packing,
load-bearing constraint, route sequencing or response-schema change is made.

## Search and update

A power-of-two segment tree stores conservative maxima of remaining current-row
length, current-row width, next-row width, and vertical clearance. Maxima may
come from different shelves: they are necessary bounds, not proof of a fit.
Left-first traversal returns candidate shelves in their original order. All six
orientation permutations are considered; the unchanged `_Shelf.try_place`
chooses the first actual fit in its original orientation order. A rejected
candidate resumes search after that leaf.

Successful placement refreshes its leaf and ancestors. Appending a shelf also
refreshes the previous top shelf with the now-fixed clearance to the new shelf's
z position. This preserves the existing prevention of retroactive vertical
expansion. The tree belongs to one packing call; it adds no shared mutable state
or external dependency. At most one leaf per package and fewer than 4N node
slots are allocated. Updates take O(log N). A search can still visit O(N) nodes
when independent geometric maxima cannot prune mixed shelves.

## Floating-point compatibility

Testing `item <= limit - used` is insufficient: at a full row, an extremely small
positive item can still satisfy the original rounded `used + item <= limit`.
The index widens the limit toward positive infinity before subtracting `used`,
then widens the rounded difference. This permits extra candidates rather than
excluding valid original fits. Exact shelf checks remain authoritative.

The original `sum(s.shelf_height for s in shelves)` is deliberately unchanged.
Python 3.12's compensated summation is not equivalent to a cached naive prefix;
that attempted optimization changed some fragmented fixtures' last-shelf
placements. Summing heights can still perform quadratic total work. Therefore
this change does **not** establish an O(N log N) whole-packer bound.

## Verification and measurements

The test's linear oracle is the unchanged packing body from main
`06da794fd3369ee86e3d062056ec8ecc2ebc121a`; it shares only the unchanged shelf
placement authority. Tests compare full arrangements, orientation, unpacked
indices and utilization for seeded fragmented/weight-limited inputs, row and
rotation cases, many fractional-height shelves, and rounding boundaries.

An artificial fixture with N unit cubes and a 1 x 1 x N container forces one
package per shelf. It illustrates scaling, not a realistic truck configuration.

| Packages | Original placement attempts | Indexed attempts | Original local seconds | Indexed local seconds |
| --- | ---: | ---: | ---: | ---: |
| 200 | 20,100 | 200 | 0.0169 | 0.0023 |
| 400 | 80,200 | 400 | 0.0677 | 0.0053 |
| 800 | 320,400 | 800 | 0.2712 | 0.0136 |
| 1,600 | 1,280,800 | 1,600 | 1.0928 | 0.0370 |

Timings are single macOS/Python 3.12 measurements and are environment dependent.
Tests enforce the placement-count bound, not timing thresholds. The four count
regressions fail when run against the actual unchanged-main module.

The dedicated workflow verifies this search and existing Haversine tests.
Current main's three-argument validation wrapper rejects the four-argument
public API before placement; that independent defect is covered by pending
#16972. Its full public-API tests are not represented as passing here.
Production lint retains 28 unchanged baseline findings; new index/tests lint
and production compilation pass. This is not a full platform CI claim.
