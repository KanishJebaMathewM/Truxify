# Traffic & Weather Services

## Overview

The Truxify backend integrates live traffic and weather data to make pricing and fuel recommendations context-aware.

---

## Location

```
backend/api/src/services/trafficService.js — live traffic surge multiplier
backend/api/src/services/weatherService.js — weather forecast (simulated)
```

---

## Traffic Service

`getLiveTrafficMultiplier(pickupLat, pickupLng)`:

- Returns `1.0` (no surge) when coordinates are missing/non-finite, or no traffic API key is configured.
- **TomTom**: uses `flowSegmentData.speedDiffPercent` — a negative speed diff (slower than free-flow) raises the multiplier, capped at `MAX_SURGE_MULTIPLIER` (2.5).
- **Google**: uses the distance-matrix `duration_in_traffic / duration` ratio, capped the same way.
- Any API error falls back to `1.0` and logs.

## Weather Service

`getWeatherForecast(lat, lng)` returns `{ temperature_c, condition, forecast_time }`:

- `lat > 40` or `lat < -40` → sub-zero (`-5 C`, `snow`).
- Otherwise → `15 C`, `clear`.

The weather service is a deterministic stub used by the fuel advisor; production would call a weather API.

---

## Why It Exists

Surge pricing that ignores traffic charges the same for a 20-minute and a 2-hour trip. The traffic multiplier makes pricing respond to real congestion; weather feeds the fuel advisor's blend recommendation.

---

## Testing

Automated tests verify:

- Missing-key and invalid-coordinate fallbacks.
- TomTom surge direction and clamping.
- Google ratio math.
- Weather stub temperature buckets.
