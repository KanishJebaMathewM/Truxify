# Trip Validator Middleware

## Overview

The Truxify backend includes a trip validation middleware (`tripValidator`) that validates trip-related requests before they reach route handlers.

---

## Location

Middleware:

```
backend/api/src/middleware/tripValidator.js
```

---

## Behavior

The middleware validates:

### Trip ID

When `req.params.id` is present it must match `/^[A-Za-z0-9_-]{1,64}$/` (1-64 alphanumeric, underscore, or hyphen characters). Violations return `400 Invalid trip ID`.

### Odometer Readings

When the body carries `odometer_km` (or `odometerKm`):

- Must be a finite non-negative number; otherwise `400 Invalid odometer reading`.
- When a previous reading is supplied via `last_odometer_km` (body) or the `x-last-odometer-km` header, the new reading must not be lower. A regression returns `400` with a monotonicity message, and a warning is logged.

---

## Why It Exists

Telemetry-driven trip data must be plausible:

- An odometer reading that drops between updates indicates bad data or spoofing.
- Malformed trip IDs break downstream lookups and can reach log lines.

Validating at the middleware boundary keeps these checks consistent across every route that mounts the validator.

---

## Testing

Automated tests verify:

- Valid and invalid trip IDs.
- Negative and non-numeric odometer readings.
- Monotonicity enforcement (body and header based).
- Equal readings are accepted.
