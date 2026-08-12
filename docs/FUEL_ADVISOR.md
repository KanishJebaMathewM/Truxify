# Fuel Advisor Service

## Overview

The Truxify backend recommends a biodiesel blend for a truck based on recent engine load and the destination's weather forecast (`services/fuelAdvisorService.js`).

---

## Location

```
backend/api/src/services/fuelAdvisorService.js
```

---

## Logic

`getFuelRecommendation(truckId, destinationLat, destinationLng)`:

1. Reads the average engine load from recent telemetry.
2. Fetches the weather forecast for the destination.
3. Applies the blend rule:

| Temperature | Engine load | Blend | Risk |
|-------------|-------------|-------|------|
| <= 0 C | < 60% | B5 | HIGH (gelling / DPF clog risk) |
| <= 0 C | >= 60% | B20 | MEDIUM (engine heat prevents gelling) |
| > 0 C | any | B20 | LOW |

Returns `{ recommended_blend, reasoning, risk_level, factors }` including the weather forecast and average engine load.

---

## Why It Exists

Biodiesel blends behave differently in cold weather, and engine load affects whether the fuel stays warm enough. A context-aware recommendation avoids gelling incidents and DPF clogging while maximizing cost savings.

---

## Testing

Automated tests verify:

- Cold/low-load → B5 with HIGH risk.
- Cold/high-load → B20 with MEDIUM risk.
- Warm weather → B20 with LOW risk.
- Weather/load fallbacks.
