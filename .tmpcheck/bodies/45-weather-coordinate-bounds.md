## Problem

`WeatherService` in `backend/api/src/services/weatherService.js` checks only whether latitude and longitude are finite. A value such as latitude 999 is treated as a polar location and produces a snow forecast; the same value can create a severe-weather advisory for a route waypoint. Longitude is never range-checked at all.

## Root cause

The service conflates numeric parsability with geographic validity. Each method implements its own ad hoc check, and the checks do not share a common range validator.

## Impact

- Invalid waypoints can trigger false severe-weather advisories and route decisions.
- Weather regions and forecasts are reported for locations that do not exist.
- Inconsistent checks across methods make the service's output depend on which entry point was used.

## Proposed fix

- Add a shared `normalizeCoordinates()` helper enforcing -90 to 90 latitude and -180 to 180 longitude.
- Use it in forecast, severe-advisory, meteorological-region, and route-risk methods.
- Keep the existing warm default for malformed or out-of-range forecasts and skip invalid route waypoints.

## Verification

- Test 90/-90/91/-91 latitude and 180/-180/181/-181 longitude.
- Assert an out-of-range waypoint does not create a severe advisory.
- Run the weather service tests.

Request: @Senthil455 please assign this issue.
