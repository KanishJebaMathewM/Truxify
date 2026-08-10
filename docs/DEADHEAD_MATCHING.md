# Deadhead Matching API

The deadhead matching endpoint pairs a driver's current route with available
loads that would otherwise be travelled empty ("deadhead").

## POST /api/deadhead/match/deadhead

Authenticated driver endpoint.

### Request body

| Field               | Type   | Description                                        |
| ------------------- | ------ | -------------------------------------------------- |
| `driver_destination`| string | The driver's planned destination.                  |
| `truck_specs`       | object | Truck capabilities (capacity, type, dimensions).   |
| `arrival_time`      | string | Expected arrival time (ISO 8601).                  |
| `available_loads`   | array  | Candidate load offers to match against.            |

### Responses

| Status | Meaning |
| ------ | ------- |
| 200    | Matching result from the ML engine. |
| 400    | Validation failure. |
| 429    | Rate limited (10 requests / minute per driver). |
| 503    | ML recommendation engine temporarily unavailable. |
| 500    | Unexpected failure. |

### Example

```json
{
  "matches": [
    { "loadId": "l1", "pickup": "Mumbai", "drop": "Pune", "score": 0.87 }
  ]
}
```

The route is rate limited to 10 requests per minute per IP and requires the
`load-offer:browse` policy.
