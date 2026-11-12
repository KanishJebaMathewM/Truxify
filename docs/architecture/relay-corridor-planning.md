# Bounded relay corridor estimates

The mounted `POST /api/relay/plan` controller and `createRelaySession` use `partitionRouteIntoCorridorLegs`. Nominal boundaries now follow the shortest great-circle arc rather than linearly blending longitude. The previous dateline fixture (0,179) to (0,-179) turned222.39km into39807.78km. The original Delhi–Bengaluru350km fixture produced425.26km and400.57km legs; Delhi–Gwalior100km repeated Agra with a zero-length leg.

## Construction and bounds

Validate numeric finite coordinates within latitude/longitude bounds and a finite positive `maxLegDistanceKm` (default350). A short direct route remains direct when it fits; an explicit smaller maximum can require partitioning even below200km. Longer plans retain at least two legs. Calculate required leg count before allocating; reject more than128 with422. Work is O(L*H log H), bounded by128 legs and the current16-hub catalog. Ambiguous antipodal endpoints reject422 instead of selecting an arbitrary arc. Other invalid inputs return400 through the planning controller.

For each spherical nominal boundary, rank nearby registered hubs (within200km) by distance with deterministic ID tie breaking. A candidate must advance along the route, precede the next nominal boundary, be unused, have positive links, and fit both the incoming link and its link to the next nominal boundary. This second check preserves a feasible fallback for the next iteration. If none fits, retain the explicit `hub:null` nominal waypoint. Check every final unrounded link before returning; public two-decimal distances can differ by up to0.005km. Endpoints and sequential continuity remain intact. Partitioned legs that round to zero at the existing two-decimal precision reject422; this prevents zero-distance records and division by a zero rounded total. Coincident direct short-haul results retain their existing behavior.

## Scope and compatibility

These remain **great-circle distance estimates**, not drivable road routes, optimal hub-network paths, traffic estimates or verified cargo handoff sites. A generated `hub:null` waypoint is advisory and cannot establish a registered handoff hub. Registered-hub availability/capacity and road reachability still require separate orchestration. No provider is contacted. The configured limit applies to the geometric estimate, not to actual road distance or driver-hours compliance.

The existing proportional payout calculation, per-leg rounding and waypoint-hash format are unchanged. This does not correct existing rounded-payout conservation issues or implement a payment. Session persistence, custody authorization, cryptographic verification and escrow remain outside this change. `findNearestHub` keeps its existing standalone API; the planner constrains its own candidate selection instead of changing unrelated callers.

## Verification

Run `npm ci --prefix tools/relay-corridor-tests --ignore-scripts` and `bash tools/relay-corridor-tests/run.sh` on Node22+. The harness copies actual planner/controller/handshake/DomainError modules and controls only the logger boundary.38 Vitest tests plus changed-file ESLint cover actual controller errors, session planner integration, dateline/high-latitude/polar/near-antipodal arcs, feasible hub selection, budgets, invalid coordinates, direct compatibility, hash/payout-formula preservation and input immutability. An independent vector-cross/dot angular distance oracle checks endpoint/continuity/positive-length/limit properties for720 hub-pair/limit cases and120 deterministic global routes. No whole repository, live provider, booking deployment, financial transaction or handoff validation is claimed.
