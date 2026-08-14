# Reverse Geocoding

## Overview

The Truxify backend reverse-geocodes coordinates into human-readable addresses using the OpenStreetMap Nominatim API, with aggressive Redis caching (`lib/reverseGeocode.js`).

---

## Location

```
backend/api/src/lib/reverseGeocode.js
```

---

## Behavior

`reverseGeocode(lat, lon)`:

- Returns `null` for null, NaN, or out-of-range coordinates (lat `[-90, 90]`, lng `[-180, 180]`).
- Rounds coordinates to 3 decimal places (~100 m precision) to maximize cache hits.
- Checks Redis (`geocode:{lat},{lng}`) first; returns the cached address on a hit.
- On a miss, calls Nominatim with a proper `User-Agent` and a configurable timeout.
- Handles HTTP 429 by honoring `Retry-After` (capped at 60 s) and retrying once.
- Builds a readable `"{localArea}, {mainArea}"` string from the address parts, falling back to the display name.
- Caches valid results for 7 days.

---

## Configuration

| Variable | Default | Description |
|----------|---------|-------------|
| `NOMINATIM_TIMEOUT_MS` | `5000` | Per-request timeout for the Nominatim call |

---

## Why It Exists

Reverse geocoding turns raw coordinates into locations users understand ("NH-48, Jaipur"). Caching is essential: the same drop-off point is geocoded repeatedly across orders, and Nominatim rate-limits anonymous traffic.

---

## Testing

Automated tests verify:

- Invalid/out-of-range coordinates return null.
- Cache hits skip the network call.
- Nominatim success, 429 retry, and non-OK paths.
- Coordinate rounding for cache keys.
