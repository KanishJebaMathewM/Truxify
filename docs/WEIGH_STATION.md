# Weigh Station & Work Zone Services

## Overview

The Truxify backend supports highway weigh stations and work-zone awareness for drivers: weigh station sync/transmit and spatial work-zone intersection queries.

---

## Location

```
backend/api/src/services/weighStationService.js — weigh station sync/transmit
backend/api/src/services/workZoneService.js     — work-zone delay prediction + bypass
```

---

## Weigh Station

- `syncAndTransmitInternalWeights(driverId, truckId, axles)`:
  - Validates the truck belongs to the driver.
  - Persists axle pressure readings.
  - Transmits the reading to the internal weigh-station pipeline.
- Data is validated at the route boundary (`syncWeightSchema`: `truck_id` + `axles` with positive `pressure_psi`).

## Work Zones

- `predictWorkZoneDelays(start, end, waypoints, departureDate, departureTime)`:
  - Deterministic pseudo-random delay heuristic seeded by coordinates + departure time.
  - Returns `{ hasSevereDelay, predictedDelayMins, problematicPoint }`.
  - Fails open (no severe delay) on any error.
- `generateBypassWaypoint(congestedPoint)` shifts the congested coordinate ~7 km perpendicularly to route around it.

---

## Why It Exists

Weigh-station compliance data feeds enforcement and analytics; work-zone predictions let the routing service avoid severe delays before they happen.

---

## Testing

Automated tests verify:

- Axle validation and truck ownership.
- Delay heuristic outcomes.
- Bypass waypoint generation.
- Fail-open behavior.
