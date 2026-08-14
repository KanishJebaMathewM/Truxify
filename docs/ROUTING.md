# Routing & OSRM Services

## Overview

The Truxify backend computes routes with OSRM and optimizes waypoint ordering, integrating predictive work-zone delay logic for dynamic rerouting.

---

## Location

```
backend/api/src/services/osrm.js            — route estimate / geometry with caching
backend/api/src/services/routingService.js  — waypoint optimization
backend/api/src/services/workZoneService.js — work-zone delay prediction + bypass waypoints
```

---

## OSRM Service

`getRouteEstimate` / `getRouteGeometry`:

- Build OSRM URLs with configurable base URL (`OSRM_URL`, default `http://localhost:5000`) and timeout (`OSRM_TIMEOUT_MS`).
- Round coordinates to 6 decimal places for cache-key stability.
- Cache results in Redis (keyed `osrm:{...}`) with the configured TTL.
- Return `null` for missing/non-finite coordinates, non-OK responses, empty routes, or network failures — never throw on bad input.
- Null results are never cached.

## Routing Service

`optimizeWaypoints(start, end, waypoints, departureDate, departureTime)`:

- Normalizes and validates every coordinate (finite, lat `[-90,90]`, lng `[-180,180]`).
- When a departure time is given, `predictWorkZoneDelays` can flag a severe delay and `generateBypassWaypoint` adds a detour waypoint.
- Calls the OSRM Trip API (`roundtrip=false&source=first&destination=last`); falls back to the original order on any failure.
- Handles 0/1 waypoint cases without calling OSRM.

---

## Why It Exists

Accurate routes and ETA drive pricing, driver matching, and ETA display. Caching and graceful fallbacks keep the API fast and resilient when the routing engine is slow or down.

---

## Testing

Automated tests verify:

- URL building, coordinate rounding, and env overrides.
- Cache hit/miss/error paths.
- Invalid-input and non-OK handling.
- Waypoint validation and bypass generation.
