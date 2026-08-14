import express from 'express';
import { supabaseAdmin } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import logger from '../middleware/logger.js';
import { predictEta } from '../services/ml.js';

const router = express.Router();

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseCoord(value, min, max) {
  const n = Number(value);
  return Number.isFinite(n) && n >= min && n <= max ? n : null;
}

// Sanitize a trip identifier before interpolating it into a PostgREST `.or()`
// filter. The filter grammar treats `)`, `,`, quotes and whitespace as syntax,
// so an unsanitized value could break out of the intended predicate
// (injection / malformed query / DoS). Rejects any such characters.
function sanitizeTripId(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed === '') return null;
  if (/[,)(\s'"]/.test(trimmed)) return null;
  return trimmed;
}

// ============================================================================
// GET /api/ml/eta?tripId=...&lat=...&lng=...
// ============================================================================
router.get('/eta', authenticate, userLimiter, async (req, res) => {
  try {
    const { tripId, lat, lng } = req.query;
    if (!tripId || typeof tripId !== 'string' || tripId.trim() === '') {
      return res.status(400).json({ error: 'tripId is required.' });
    }

    // Sanitize before interpolating into the PostgREST filter (see sanitizeTripId).
    const safeTripId = sanitizeTripId(tripId);
    if (!safeTripId) {
      return res.status(400).json({ error: 'tripId contains invalid characters.' });
    }

    // Resolve the trip by primary key or display id, then its linked order for
    // the drop coordinates that define the remaining route.
    const { data: trip, error: tripErr } = await supabaseAdmin
      .from('trips')
      .select('id, trip_display_id, order_id')
      .or(`id.eq.${safeTripId},trip_display_id.eq.${safeTripId}`)
      .maybeSingle();

    if (tripErr) {
      logger.error('[MlEta] Failed to resolve trip:', tripErr);
      return res.status(500).json({ error: 'Failed to resolve trip.' });
    }
    if (!trip) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    let order = null;
    if (trip.order_id) {
      const { data: orderRes, error: orderErr } = await supabaseAdmin
        .from('orders')
        .select('pickup_lat, pickup_lng, drop_lat, drop_lng, customer_id, driver_id')
        .eq('id', trip.order_id)
        .maybeSingle();

      if (orderErr) {
        logger.error('[MlEta] Failed to resolve order for trip:', orderErr);
        return res.status(500).json({ error: 'Failed to resolve order.' });
      }
      order = orderRes;
    }

    if (!order || !order.drop_lat || !order.drop_lng) {
      return res.status(422).json({ error: 'Trip has no destination coordinates for ETA.' });
    }

    if (req.user.role !== 'admin') {
      const isOwner =
        order.customer_id === req.user.id || order.driver_id === req.user.id;
      if (!isOwner) {
        return res.status(404).json({ error: 'Trip not found.' });
      }
    }

    const currentLat = parseCoord(lat, -90, 90);
    const currentLng = parseCoord(lng, -180, 180);

    const latProvided = lat !== undefined && lat !== null && lat !== '';
    const lngProvided = lng !== undefined && lng !== null && lng !== '';

    if (latProvided !== lngProvided) {
      return res.status(400).json({ error: 'Both lat and lng must be provided together.' });
    }

    let positionSource = 'pickup';
    let distanceKm;
    if (latProvided) {
      if (currentLat === null || currentLng === null) {
        return res.status(400).json({ error: 'Invalid lat/lng: lat must be within [-90, 90] and lng within [-180, 180].' });
      }
      if (currentLat === 0 && currentLng === 0) {
        return res.status(422).json({ error: 'lat/lng at (0,0) is not a valid live position.' });
      }
      positionSource = 'live';
      distanceKm = haversineKm(currentLat, currentLng, Number(order.drop_lat), Number(order.drop_lng));
    } else {
      distanceKm = haversineKm(Number(order.pickup_lat), Number(order.pickup_lng), Number(order.drop_lat), Number(order.drop_lng));
    }

    const now = new Date();
    const routeType = distanceKm > 20 ? 'highway' : 'city';

    try {
      const prediction = await predictEta({
        routeDistance: distanceKm,
        timeOfDay: now.getHours(),
        dayOfWeek: now.getDay(),
        routeType,
        historicalSpeed: routeType === 'highway' ? 55 : 40,
      });

      return res.json({
        tripId: trip.trip_display_id || trip.id,
        eta_minutes: prediction.eta_minutes,
        confidence_interval: prediction.confidence_interval,
        distance_km: Math.round(distanceKm * 100) / 100,
        route_type: routeType,
        source: 'ml',
        position_source: positionSource,
      });
    } catch (mlErr) {
      logger.warn('[MlEta] ML ETA prediction failed:', mlErr.message);
      return res.status(503).json({ error: mlErr.message });
    }
  } catch (err) {
    logger.error('Internal Server Error in GET /api/ml/eta:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
