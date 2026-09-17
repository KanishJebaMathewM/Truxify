# Weigh Station Service API

The `weighStationService` provides integration points for commercial weigh-in-motion (WIM) bypass systems (e.g., Drivewyze, PrePass). 

> ⚠️ **IMPORTANT: Mock Implementation**  
> As of the current release, **no real WIM provider API is configured**. Both exported functions are mock implementations that fail closed, returning an `UNSUPPORTED` action. This prevents the system from inventing regulatory verdicts (e.g., random "BYPASS" decisions) that a driver might legally rely upon.

## Exported Functions

### 1. `checkBypassEligibility(driverId, lat, lng)`

Checks if a specific driver and truck are eligible for a commercial bypass at a given geographic location.

#### Parameters
| Name | Type | Description |
|------|------|-------------|
| `driverId` | `string` | The unique identifier of the driver. |
| `lat` | `number` | The latitude of the weigh station or checkpoint. |
| `lng` | `number` | The longitude of the weigh station or checkpoint. |

#### Returns
`Promise<Object>` - A standardized response object.

#### Response Shape
```javascript
{
  action: 'UNSUPPORTED',
  supported: false,
  simulated: true,
  stationId: null,
  reason: 'Weigh-in-motion bypass is not available: no WIM provider is configured. This is not a regulatory verdict.',
  timestamp: '2026-09-16T12:00:00.000Z'
}
