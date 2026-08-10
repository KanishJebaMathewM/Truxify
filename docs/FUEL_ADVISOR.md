# Fuel Advisor Service

`FuelAdvisorService` recommends a biodiesel blend for a truck heading to a
destination, combining recent engine load with the destination weather.

## Recommendation matrix

| Temperature     | Avg engine load | Blend | Risk   |
| --------------- | --------------- | ----- | ------ |
| > 0°C           | any             | B20   | LOW    |
| <= 0°C          | < 60%           | B5    | HIGH   |
| <= 0°C          | >= 60%          | B20   | MEDIUM |

## Engine load

`_getAverageEngineLoad(truckId)` reads the truck's active order and recent
`gpsUpdate` trip events, averaging the `engineLoad` payload values. Falls
back to 50% when:

- No active order exists.
- The order query errors.
- No recent GPS events exist.
- No numeric `engineLoad` values are present.

## Output

```json
{
  "recommended_blend": "B5",
  "reasoning": "...",
  "risk_level": "HIGH",
  "factors": {
    "weather_forecast": { "temperature_c": -5, "condition": "snow" },
    "average_engine_load_percent": 40
  }
}
```

## Dependencies

- `weatherService` — injected, returns `{ temperature_c, condition }`.
- `supabase` — injected, used for order and trip-event lookups.
- `logger` — injected.
