# Bounded CVRPTW feasibility contract

The standalone solver finds the first complete feasible open pickup/delivery
itinerary. It uses deterministic nearest-first depth-first alternative search,
with pickup/delivery bit masks and earliest-clock dominance for identical
(picked, delivered, last-stop) states. Earlier clock dominates because travel and
service times are static, waiting is allowed, and distance is not the objective.
No distance-optimality, road-network travel or OR-Tools claim is made.

Every admitted transition respects pickup precedence, exact simultaneous active
payload and service-start windows. Payload and accumulated clock use exact
rational arithmetic over admitted float values, preserving tiny loads beside
large ones and small time increments at a large depot clock. Haversine distance
and speed-derived travel remain floating-point estimates; these are not road ETAs.
Successful times/loads round outward, without inward display rounding. Render
rounded values separately from constraint data.

## Outcomes and migration

- `success: true`, reason `feasible`: all supplied consignments have one pickup
  and one later delivery; every stop is within its service-start window and
  capacity. Zero-weight consignments are supported without relaxing precedence.
- `success: false`, reason `infeasible`: the admitted finite static problem has
  no feasible ordering after complete search, or an individual weight exceeds
  capacity. No partial itinerary is returned.
- `search_limit`: feasibility is unknown because the admitted-state budget was
  reached. It is not a proof of infeasibility. `numeric_limit` similarly indicates
  a branch requiring quantities outside finite float publication range.
- Default budget is 10,000 admitted states, including the root; optional
  `max_search_states` accepts an integer from 1 to 100,000. No consignment set is
  silently truncated. Search can be exponential before its state budget; sorting
  transitions and checking active constraints also cost work proportional to the
  number of supplied stops. This is not a constant memory/time guarantee.
- Existing successful itinerary fields remain, but time/load/distance values
  retain precision. `start_service_time_min`, `reason`, `search_states`, and
  `total_duration_mins` are explicit. Duration is elapsed from depot start, rather
  than an absolute wall clock divided by 60. Empty input returns a consistent
  successful empty `itinerary` and compatibility `stops` list.
- All input is validated before search: finite nonnegative mass/time/capacity,
  positive speed, valid coordinates/windows and unique nonempty string/integer
  IDs. Missing IDs retain `c_<index>` defaults; collisions are rejected. Optional
  missing depot coordinates retain the first-pickup fallback. Caller data remain
  untouched, and malformed input raises a clear TypeError/ValueError.

## Reachability and native verification

The existing consolidation router is not in the live registry and uses relative
imports inconsistent with that registry. This PR repairs the actual solver
component; it does not register that route or claim serving integration. Tests
load the real dependency-free source via importlib, avoiding services.__init__'s
unrelated eager traffic imports without replacing the solver with a double.

```
python -m pip install pytest==9.0.3 ruff==0.16.9
python -m pytest -q backend/ml/tests/test_cvrptw_feasibility.py
python -m ruff check backend/ml/services/cvrptw_solver.py backend/ml/tests/test_cvrptw_feasibility.py
```

30 native tests include an independent exhaustive permutation oracle across 80
seeded small problems, itinerary replay, a nearest-order dead end with a feasible
alternative, impossible overweight/deadline cases, exact payload/clock boundaries,
waiting/service duration, full zero-mass completion, input ownership, antipodal
geometry and strict JSON/numeric limits. No providers or production data are used.
