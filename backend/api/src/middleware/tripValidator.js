import logger from '../middleware/logger.js';

const TRIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const DEFAULT_DRIFT_TOLERANCE_KM = 0; // 0 = strict monotonicity; set > 0 for GPS drift tolerance

/**
 * Validates trip-related requests.
 *
 * Replaces the previous stub that only checked that `req.params.id` is a
 * non-empty string. Current checks:
 *   - `req.params.id` (when present) must be a short alphanumeric id.
 *   - `req.body.odometer_km` / `req.body.odometerKm` (when present) must be a
 *     finite non-negative number.
 *   - When a prior odometer reading is available via `req.body.last_odometer_km`
 *     (or a header `x-last-odometer-km`), the new reading must not decrease —
 *     a monotonicity violation is treated as a client error.
 */
export const tripValidator = {
  validate: (req, res, next) => {
    const tripId = req.params && req.params.id;
    if (tripId !== undefined && tripId !== null) {
      if (typeof tripId !== 'string' || !TRIP_ID_PATTERN.test(tripId)) {
        return res.status(400).json({
          error: 'Invalid trip ID',
          details: 'Trip ID must be a string of 1-64 alphanumeric, underscore or hyphen characters.',
        });
      }
    }

    const odometerRaw = req.body && (req.body.odometer_km ?? req.body.odometerKm);
    if (odometerRaw !== undefined && odometerRaw !== null) {
      const odometer = Number(odometerRaw);
      if (!Number.isFinite(odometer) || odometer < 0) {
        return res.status(400).json({
          error: 'Invalid odometer reading',
          details: 'odometer_km must be a finite non-negative number.',
        });
      }

      const lastRaw = req.body && (req.body.last_odometer_km ?? req.body.lastOdometerKm);
      const lastFromHeader = req.headers && req.headers['x-last-odometer-km'];
      const lastOdometerRaw = lastRaw ?? lastFromHeader;

      if (lastOdometerRaw !== undefined && lastOdometerRaw !== null) {
        const lastOdometer = Number(lastOdometerRaw);
        if (Number.isFinite(lastOdometer) && odometer < lastOdometer - DEFAULT_DRIFT_TOLERANCE_KM) {
          logger.warn(
            {
              event: 'TRIP_ODOMETER_MONOTONICITY_VIOLATION',
              tripId,
              odometerKm: odometer,
              lastOdometerKm: lastOdometer,
              requestId: req.requestId || req.id,
            },
            'Trip odometer reading regressed below the previous reading'
          );
          return res.status(400).json({
            error: 'Invalid odometer reading',
            details: 'odometer_km must not be less than the previous reading.',
          });
        }
      }
    }

    next();
  },
};
