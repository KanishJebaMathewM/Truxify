# Route Estimate API

## GET /api/routes/estimate

Returns a road distance and duration estimate between two coordinates using
the OSRM engine.

### Query parameters

| Parameter     | Required | Description            |
| ------------- | -------- | ---------------------- |
| `pickup_lat`  | yes      | Pickup latitude.       |
| `pickup_lng`  | yes      | Pickup longitude.      |
| `drop_lat`    | yes      | Drop latitude.         |
| `drop_lng`    | yes      | Drop longitude.        |

Coordinates must be finite numbers within valid lat/lng ranges.

### Responses

| Status | Meaning                                              |
| ------ | ---------------------------------------------------- |
| 200    | `{ distance_km, duration_hours }`                    |
| 400    | Missing or invalid coordinates.                      |
| 404    | No route could be calculated.                        |
| 500    | Internal error.                                      |

```json
{
  "distance_km": 143.2,
  "duration_hours": 3.5
}
```

Requires authentication and is rate limited per user.
