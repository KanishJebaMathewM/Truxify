/**
 * @openapi
 * components:
 *   schemas:
 *     BatchSyncRequest:
 *       type: object
 *       required:
 *         - events
 *         - idempotencyKey
 *       properties:
 *         events:
 *           type: array
 *           maxItems: 100
 *           items:
 *             type: object
 *             properties:
 *               id:
 *                 type: string
 *               trip_id:
 *                 type: string
 *                 nullable: true
 *               type:
 *                 type: string
 *               occurred_at:
 *                 type: string
 *                 format: date-time
 *               payload:
 *                 type: object
 *               retry_count:
 *                 type: integer
 *         idempotencyKey:
 *           type: string
 *     BatchSyncResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         processed_count:
 *           type: integer
 *     TripEventsResponse:
 *       type: object
 *       properties:
 *         trip_id:
 *           type: string
 *         events:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               event_id:
 *                 type: string
 *               user_id:
 *                 type: string
 *               trip_id:
 *                 type: string
 *               event_type:
 *                 type: string
 *               event_timestamp:
 *                 type: string
 *                 format: date-time
 *               latitude:
 *                 type: number
 *                 nullable: true
 *               longitude:
 *                 type: number
 *                 nullable: true
 *               metadata:
 *                 type: object
 *               created_at:
 *                 type: string
 *                 format: date-time
 */

import express from 'express';
import { z } from 'zod';
import { supabase, supabaseAdmin } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateParams } from '../middleware/validate.js';
import { uuidParamSchema } from '../validation/requestSchemas.js';
import logger from '../middleware/logger.js';

const router = express.Router();
const DEFAULT_EVENTS_LIMIT = 100;
const MAX_EVENTS_LIMIT = 500;

function parsePositiveIntegerQuery(value, fallback, max) {
  if (value === undefined) return { value: fallback };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    return { error: 'Query value must be a positive integer' };
  }

  const parsed = Number.parseInt(value, 10);
  if (parsed < 1) {
    return { error: 'Query value must be a positive integer' };
  }

  return { value: Math.min(parsed, max) };
}

// ============================================================================
// 🛡️ OFFLINE SYNC VALIDATION SCHEMAS (ISSUE #362)
// ============================================================================

// Per-event-type payload validation
// otpDelivery events are strictly validated — only stopId allowed, no otp field
// All other event types pass through with generic payload validation
const otpDeliveryPayloadSchema = z.object({
  stopId: z.string().min(1),
}).strict();

function validateEventPayload(type, payload) {
  if (type === 'otpDelivery') {
    return otpDeliveryPayloadSchema.safeParse(payload);
  }
  if (type === 'gpsUpdate') {
    return z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      timestampMs: z.number().int().positive().optional(),
    }).safeParse(payload);
  }
  return { success: true, data: payload };
}

const SENSITIVE_FIELDS = [
  'otp', 'delivery_otp', 'token', 'secret', 'password',
  'phone_number', 'driver_phone', 'customer_phone', 'email',
  'current_location', 'driver_location',
  'license_number', 'aadhaar_number', 'pan_number',
];

function deepSanitize(obj, keys) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(item => deepSanitize(item, keys));
  const clean = {};
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k)) continue;
    clean[k] = deepSanitize(v, keys);
  }
  return clean;
}

/**
 * Replays an offline 'markStopCompleted' event so a stop completed while the
 * driver was offline is actually persisted once the batch syncs. Mirrors the
 * online PUT /api/trips/:id/stops/:stopId/complete behaviour.
 */
async function replayMarkStopCompleted(tripId, payload) {
  const stopId = payload?.stopId;
  if (!stopId) {
    logger.warn('[SyncEngine] markStopCompleted event missing stopId');
    return;
  }

  const { data: stop, error: stopErr } = await supabaseAdmin
    .from('trip_stops')
    .select('id, is_completed')
    .eq('id', stopId)
    .eq('trip_display_id', tripId)
    .maybeSingle();
  if (stopErr) {
    logger.error('[SyncEngine] Failed to fetch stop for markStopCompleted replay:', stopErr.message);
    return;
  }
  if (!stop || stop.is_completed) return;

  const { error: updateErr } = await supabaseAdmin
    .from('trip_stops')
    .update({
      is_completed: true,
      is_current: false,
      status_label: 'Delivered',
      updated_at: new Date().toISOString(),
    })
    .eq('id', stop.id);
  if (updateErr) {
    logger.error('[SyncEngine] Failed to complete stop during replay:', updateErr.message);
    return;
  }

  // Advance the current-stop marker to the next uncompleted stop.
  const { data: nextStops, error: nextErr } = await supabaseAdmin
    .from('trip_stops')
    .select('id')
    .eq('trip_display_id', tripId)
    .eq('is_completed', false)
    .order('sort_order', { ascending: true })
    .limit(1);
  if (nextErr) {
    logger.error('[SyncEngine] Failed to resolve next stop during replay:', nextErr.message);
  } else if (nextStops && nextStops.length > 0) {
    await supabaseAdmin
      .from('trip_stops')
      .update({
        is_current: true,
        status_label: 'In Progress',
        updated_at: new Date().toISOString(),
      })
      .eq('id', nextStops[0].id);
  }
}

// Schema for an individual Trip Event from the Flutter offline database
const tripEventSchema = z.object({
  id: z.string().min(1, "Event ID is required"),
  trip_id: z.string().optional().nullable(),
  type: z.string().min(1, "Event type is required"),
  occurred_at: z.string().datetime("occurred_at must be a valid ISO 8601 date string"),
  payload: z.record(z.any()).optional().default({}),
  retry_count: z.number().int().nonnegative().optional().default(0)
});

// Schema for the Batch Payload generated by apps/customer/.../sync_engine.dart
const batchSyncSchema = z.object({
  events: z.array(tripEventSchema).max(100, "Maximum batch size exceeded (Limit: 100)"),
  idempotencyKey: z.string().min(1, "Idempotency key is required to prevent duplicates")
});

// Reusable Middleware for validating the batch payload
const validateBatchPayload = (schema) => (req, res, next) => {
  try {
    req.body = schema.parse(req.body);
    next();
  } catch (error) {
    if (error instanceof z.ZodError) {
      const formattedErrors = (error.issues || error.errors).map(err => ({
        field: err.path.join('.'),
        message: err.message
      }));
      // The Flutter app explicitly looks for 422 to stop retrying bad payloads
      return res.status(422).json({
        error: 'Unprocessable Entity: Malformed batch payload',
        details: formattedErrors
      });
    }
    next(error);
  }
};

// ============================================================================
// 📡 OFFLINE SYNC ENDPOINT: BATCH EVENT INGESTION
// ============================================================================

/**
 * @openapi
 * /api/v1/trips/events/batch:
 *   post:
 *     tags: [Trips]
 *     summary: Batch ingest offline trip events
 *     description: Handles batched telemetry and trip events uploaded by mobile clients after recovering from network loss. Supports idempotency to prevent duplicate processing.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/BatchSyncRequest'
 *     responses:
 *       200:
 *         description: Empty batch acknowledged
 *       202:
 *         description: Batch processed successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/BatchSyncResponse'
 *       422:
 *         description: Malformed batch payload
 *       500:
 *         description: Database processing error
 */
/**
 * POST /api/v1/trips/events/batch
 * Handles batched telemetry and trip events uploaded by the mobile client
 * after recovering from network loss.
 */
router.post('/events/batch', authenticate, userLimiter, validateBatchPayload(batchSyncSchema), async (req, res) => {
  const { events, idempotencyKey } = req.body;
  const userId = req.user.id;

  if (events.length === 0) {
    // Flutter expects 200 or 202 for success.
    return res.status(200).json({ error: 'Empty batch received, nothing to process.' });
  }

  try {
    // 1. Validate per-event-type payloads and strip sensitive fields
    for (const event of events) {
      // Explicit coordinate validation for telemetry frames
      const isTelemetry = event.type === 'gpsUpdate' || (event.payload && ('lat' in event.payload || 'lng' in event.payload));
      if (isTelemetry) {
        const lat = event.payload?.lat;
        const lng = event.payload?.lng;
        const numLat = Number(lat);
        const numLng = Number(lng);

        if (
          lat === null || lat === undefined ||
          lng === null || lng === undefined ||
          Number.isNaN(numLat) || Number.isNaN(numLng) ||
          numLat < -90 || numLat > 90 ||
          numLng < -180 || numLng > 180
        ) {
          logger.warn(`[SyncEngine] Rejected batch: invalid coordinate data in event ${event.id}`);
          return res.status(400).json({ error: 'Invalid coordinate data' });
        }
      }

      const result = validateEventPayload(event.type, event.payload || {});
      if (!result.success) {
        logger.warn('[SyncEngine] Invalid payload for event', event.id, '(type:', event.type, '):', result.error.issues);
        return res.status(422).json({
          error: 'Unprocessable Entity: Invalid event payload for type ' + event.type,
          details: result.error.issues,
        });
      }
    }

    // 2. Ownership check: events may only be attached to trips (orders) the
    // caller owns or is assigned to. Never trust a client-supplied trip_id.
    // This runs BEFORE the idempotency short-circuit below, otherwise a
    // replayed batch would return 202 and skip authorization entirely.
    if (req.user.role !== 'admin') {
      const tripIds = [...new Set(events.map(event => event.trip_id).filter(Boolean))];

      if (tripIds.length > 0) {
        // Trip ids sent by the app are trip display ids ('TX-' + order display id),
        // not the orders.id uuid. Map them back to the bare order display id before
        // looking up the owning order, otherwise every batch is rejected with 403.
        const orderDisplayIds = tripIds.map(tripId =>
          typeof tripId === 'string' && tripId.startsWith('TX-') ? tripId.slice(3) : tripId
        );

        const { data: ownedOrders, error: ownershipError } = await supabase
          .from('orders')
          .select('order_display_id, driver_id, customer_id')
          .in('order_display_id', orderDisplayIds);

        if (ownershipError) {
          logger.error('[SyncEngine] Failed to verify trip ownership:', ownershipError.message);
          return res.status(500).json({ error: 'Internal Server Error' });
        }

        const orderByDisplayId = new Map((ownedOrders || []).map(order => [order.order_display_id, order]));

        for (const tripId of tripIds) {
          const orderDisplayId = typeof tripId === 'string' && tripId.startsWith('TX-') ? tripId.slice(3) : tripId;
          const order = orderByDisplayId.get(orderDisplayId);
          const isDriver = order?.driver_id === userId;
          const isCustomer = order?.customer_id === userId;
          if (!order || (!isDriver && !isCustomer)) {
            logger.warn('[SyncEngine] Rejected batch: user', userId, 'not authorised for trip', tripId);
            return res.status(403).json({ error: 'Access Denied: You are not authorised to add events to this trip.' });
          }
        }
      }
    }

    // 3. Check Idempotency (Prevent double processing)
    // We check if this exact batch has already been processed recently.
    const { data: existingBatch } = await supabase
      .from('processed_batches')
      .select('id')
      .eq('idempotency_key', idempotencyKey)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingBatch) {
      logger.info('[SyncEngine] Ignored duplicate batch:', idempotencyKey);
      // Return 202 Accepted so the Flutter app marks them as synced locally
      return res.status(202).json({ error: 'Batch already processed.' });
    }

    const recordsToInsert = events.map(event => {
      const safeMetadata = deepSanitize(event.payload, SENSITIVE_FIELDS);

      return {
        event_id: event.id,
        user_id: userId,
        trip_id: event.trip_id || null,
        event_type: event.type,
        event_timestamp: event.occurred_at,
        latitude: event.payload?.lat !== undefined ? Number(event.payload.lat) : null,
        longitude: event.payload?.lng !== undefined ? Number(event.payload.lng) : null,
        metadata: safeMetadata,
        created_at: new Date().toISOString()
      };
    });

    // 3. Bulk Insert / Upsert into the trip_events table
    // Upsert ensures that if a specific event ID already exists, it just updates it
    // rather than failing the whole batch.
    const { error: insertError } = await supabase
      .from('trip_events')
      .upsert(recordsToInsert, { onConflict: 'event_id' });

    if (insertError) {
      logger.error('[SyncEngine] Bulk Insert Failed:', insertError.message);
      // Return 500 so the Flutter app knows to apply exponential backoff and retry later
      return res.status(500).json({ error: 'Database failed to process batch.' });
    }

    // 3.5 Replay actionable trip events (e.g. offline stop completions) so an
    // event queued while offline has its effect applied once connectivity returns.
    for (const event of events) {
      if (event.type === 'markStopCompleted' && event.trip_id) {
        await replayMarkStopCompleted(event.trip_id, event.payload || {});
      }
    }

    // 4. Log the successful batch using the idempotency key
    // This prevents the same batch from being uploaded again if the client crashes
    // before it can mark them as synced in its local SQLite db.
    const { error: idempotencyError } = await supabase
      .from('processed_batches')
      .insert({
        idempotency_key: idempotencyKey,
        user_id: userId,
        event_count: events.length,
        processed_at: new Date().toISOString()
      });

    if (idempotencyError) {
      // Non-fatal error. We processed the events, but failed to log the key.
      logger.warn('[SyncEngine] Failed to log idempotency key:', idempotencyKey);
    }

    // 5. Respond with 202 Accepted
    // This triggers `return true;` in the Flutter SyncEngine, allowing it to
    // clear the local database queue.
    logger.info('[SyncEngine] Successfully processed batch of', events.length, 'events for User:', userId);
    return res.status(202).json({
      message: 'Batch processed successfully',
      processed_count: events.length
    });

  } catch (err) {
    logger.error('[SyncEngine] Critical processing error:', err.message);
    // 500 triggers the `_backoffDelay` in the Flutter app
    return res.status(500).json({ error: 'Internal server error during batch processing.' });
  }
});

// ============================================================================
// GET TRIP EVENTS (DRIVER, CUSTOMER, OR ADMIN)
// ============================================================================
/**
 * @openapi
 * /api/trips/{id}/events:
 *   get:
 *     tags: [Trips]
 *     summary: Get trip events
 *     description: Returns all telemetry/milestone events for a given trip, ordered chronologically. Accessible by trip driver, order customer, or admin.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *         description: Filter by event type (e.g., gpsUpdate)
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *       - in: query
 *         name: min_lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: min_lng
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_lng
 *         schema:
 *           type: number
 *     responses:
 *       200:
 *         description: Trip events with metadata
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TripEventsResponse'
 *       403:
 *         description: Access denied
 *       404:
 *         description: Trip not found
 */
/**
 * GET /api/trips/:id/events
 *
 * Returns all telemetry/milestone events for a given trip, ordered
 * chronologically.
 *
 * Access control:
 *   - The trip's driver (trip_events.user_id === req.user.id)
 *   - The order's customer (orders.customer_id === req.user.id)
 *   - Any admin
 *
 * Optional query param: ?type=gpsUpdate  (filters by event_type)
 */
router.get('/:id/events', authenticate, userLimiter, validateParams(uuidParamSchema), async (req, res) => {
  const tripId = req.params.id;
  const { type, sort, min_lat, max_lat, min_lng, max_lng } = req.query;
  const isAscending = sort !== 'desc';
  const parsedPage = parsePositiveIntegerQuery(req.query.page, 1, Number.MAX_SAFE_INTEGER);
  const parsedLimit = parsePositiveIntegerQuery(req.query.limit, DEFAULT_EVENTS_LIMIT, MAX_EVENTS_LIMIT);

  if (parsedPage.error || parsedLimit.error) {
    return res.status(400).json({ error: parsedPage.error || parsedLimit.error });
  }

  const page = parsedPage.value;
  const limit = parsedLimit.value;
  const offset = (page - 1) * limit;

  try {
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, driver_id, customer_id')
      .eq('id', tripId)
      .maybeSingle();

    if (orderErr) {
      logger.error(`[TripEvents] Failed to look up order for trip ${tripId}: ${orderErr.message}`);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (!order) {
      return res.status(404).json({ error: 'Trip not found.' });
    }

    if (req.user.role !== 'admin') {
      const isDriver = order?.driver_id === req.user.id;
      const isCustomer = order?.customer_id === req.user.id;
      if (!isDriver && !isCustomer) {
        return res.status(403).json({ error: 'Access Denied: You are not authorised to view events for this trip.' });
      }
    }

    let eventsQuery = supabase
      .from('trip_events')
      .select('event_id, user_id, trip_id, event_type, event_timestamp, latitude, longitude, metadata, created_at', { count: 'exact' })
      .eq('trip_id', tripId);

    if (type && typeof type === 'string') {
      eventsQuery = eventsQuery.eq('event_type', type);
    }

    const coordParams = [
      { raw: min_lat, min: -90, max: 90, label: 'min_lat' },
      { raw: max_lat, min: -90, max: 90, label: 'max_lat' },
      { raw: min_lng, min: -180, max: 180, label: 'min_lng' },
      { raw: max_lng, min: -180, max: 180, label: 'max_lng' },
    ];
    const parsedCoords = {};
    for (const { raw, min, max, label } of coordParams) {
      if (raw === undefined) continue;
      if (typeof raw !== 'string' || raw.trim() === '') {
        return res.status(400).json({ error: `Query parameter ${label} must be a number.` });
      }
      const parsed = Number(raw);
      if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
        return res.status(400).json({ error: `Query parameter ${label} must be a number within [${min}, ${max}].` });
      }
      parsedCoords[label] = parsed;
    }

    if (parsedCoords.min_lat !== undefined) eventsQuery = eventsQuery.gte('latitude', parsedCoords.min_lat);
    if (parsedCoords.max_lat !== undefined) eventsQuery = eventsQuery.lte('latitude', parsedCoords.max_lat);
    if (parsedCoords.min_lng !== undefined) eventsQuery = eventsQuery.gte('longitude', parsedCoords.min_lng);
    if (parsedCoords.max_lng !== undefined) eventsQuery = eventsQuery.lte('longitude', parsedCoords.max_lng);

    const { data: events, error: eventsErr, count } = await eventsQuery
      .order('event_timestamp', { ascending: isAscending })
      .range(offset, offset + limit - 1);

    if (eventsErr) {
      return res.status(500).json({
        error: 'Failed to fetch trip events.',
        code: 'TRIP_EVENTS_FETCH_ERROR',
        details: eventsErr.message,
        timestamp: new Date().toISOString(),
      });
    }

    return res.json({
      trip_id: tripId,
      events: events || [],
      pagination: {
        page,
        limit,
        total: count || 0,
        totalPages: count ? Math.ceil(count / limit) : 0,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal Server Error', details: err.message });
  }
});

// ============================================================================
// TRIP DATA ACCESS (DRIVER) — #6325
// ----------------------------------------------------------------------------
// The driver app reads trip items/stops/route-points from
// /api/trips/{tripDisplayId}/... and starts / completes trip work there. Trips
// and their child rows are created by the service role on trip start (the
// trips RLS is read-only for authenticated users by design).
// ============================================================================

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isAdmin(user) {
  return user?.role === 'admin';
}

function canAccessOrder(user, order) {
  return isAdmin(user) || (order && order.driver_id === user.id);
}

function canAccessTrip(user, trip) {
  return isAdmin(user) || (trip && trip.driver_id === user.id);
}

// Resolves a path id that may be a trips.trip_display_id, a trips.id, an
// orders.order_display_id or an orders.id. Returns { trip }, { order } or
// { error }.
async function findTripContext(ref) {
  let { data: trip, error: tripErr } = await supabaseAdmin
    .from('trips')
    .select('id, trip_display_id, driver_id, order_id, status')
    .eq('trip_display_id', ref)
    .maybeSingle();

  if (tripErr) return { error: tripErr };
  if (trip) return { trip };

  if (UUID_REGEX.test(ref)) {
    const { data: tripById, error: tripByIdErr } = await supabaseAdmin
      .from('trips')
      .select('id, trip_display_id, driver_id, order_id, status')
      .eq('id', ref)
      .maybeSingle();
    if (tripByIdErr) return { error: tripByIdErr };
    if (tripById) return { trip: tripById };
  }

  const { data: order, error: orderErr } = await supabaseAdmin
    .from('orders')
    .select('id, order_display_id, driver_id, customer_id, status, total_amount, pickup_address, drop_address, pickup_date, base_freight, goods_type, weight_tonnes')
    .eq('order_display_id', ref)
    .maybeSingle();

  if (orderErr) return { error: orderErr };
  if (order) return { order };

  if (UUID_REGEX.test(ref)) {
    const { data: orderById, error: orderByIdErr } = await supabaseAdmin
      .from('orders')
      .select('id, order_display_id, driver_id, customer_id, status, total_amount, pickup_address, drop_address, pickup_date, base_freight, goods_type, weight_tonnes')
      .eq('id', ref)
      .maybeSingle();
    if (orderByIdErr) return { error: orderByIdErr };
    if (orderById) return { order: orderById };
  }

  return { error: null };
}

async function requireOwnedTrip(req, res, ctx) {
  let trip = ctx?.trip || null;
  const order = ctx?.order || null;

  if (!trip && order) {
    const { data: linkedTrip, error: linkedErr } = await supabaseAdmin
      .from('trips')
      .select('id, trip_display_id, driver_id, order_id, status')
      .eq('order_id', order.id)
      .eq('status', 'active')
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (linkedErr) return { error: { status: 500, body: { error: 'Failed to resolve trip.', details: linkedErr.message } } };
    trip = linkedTrip || null;
  }

  if (!trip) {
    return { error: { status: 404, body: { error: 'Active trip not found.' } } };
  }

  if (!canAccessTrip(req.user, trip)) {
    return { error: { status: 403, body: { error: 'Access Denied: Trip does not belong to you.' } } };
  }

  return { trip };
}

/**
 * GET /api/trips/{tripDisplayId}/items
 * Returns all items for a trip. The driver must own the trip.
 */
router.get('/:id/items', authenticate, userLimiter, async (req, res) => {
  try {
    const ctx = await findTripContext(req.params.id);
    if (ctx.error) return res.status(500).json({ error: 'Internal Server Error', details: ctx.error.message });
    const owned = await requireOwnedTrip(req, res, ctx);
    if (owned.error) return res.status(owned.error.status).json(owned.error.body);

    const { data: items, error: itemsErr } = await supabaseAdmin
      .from('trip_items')
      .select('*')
      .eq('trip_display_id', owned.trip.trip_display_id)
      .order('sort_order', { ascending: true });

    if (itemsErr) return res.status(500).json({ error: 'Failed to fetch trip items.', details: itemsErr.message });
    return res.json(items || []);
  } catch (err) {
    logger.error('[Trips] Fetch trip items error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/trips/{tripDisplayId}/stops
 * Returns all stops for a trip, ordered by sort_order. Driver must own the trip.
 */
router.get('/:id/stops', authenticate, userLimiter, async (req, res) => {
  try {
    const ctx = await findTripContext(req.params.id);
    if (ctx.error) return res.status(500).json({ error: 'Internal Server Error', details: ctx.error.message });
    const owned = await requireOwnedTrip(req, res, ctx);
    if (owned.error) return res.status(owned.error.status).json(owned.error.body);

    const { data: stops, error: stopsErr } = await supabaseAdmin
      .from('trip_stops')
      .select('*')
      .eq('trip_display_id', owned.trip.trip_display_id)
      .order('sort_order', { ascending: true });

    if (stopsErr) return res.status(500).json({ error: 'Failed to fetch trip stops.', details: stopsErr.message });
    return res.json(stops || []);
  } catch (err) {
    logger.error('[Trips] Fetch trip stops error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * GET /api/trips/{tripDisplayId}/route-points
 * Returns route geometry points for a trip. Driver must own the trip.
 */
router.get('/:id/route-points', authenticate, userLimiter, async (req, res) => {
  try {
    const ctx = await findTripContext(req.params.id);
    if (ctx.error) return res.status(500).json({ error: 'Internal Server Error', details: ctx.error.message });
    const owned = await requireOwnedTrip(req, res, ctx);
    if (owned.error) return res.status(owned.error.status).json(owned.error.body);

    const { data: points, error: pointsErr } = await supabaseAdmin
      .from('route_map_points')
      .select('*')
      .eq('trip_display_id', owned.trip.trip_display_id)
      .order('sort_order', { ascending: true });

    if (pointsErr) return res.status(500).json({ error: 'Failed to fetch route points.', details: pointsErr.message });
    return res.json(points || []);
  } catch (err) {
    logger.error('[Trips] Fetch route points error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * PUT /api/trips/{tripDisplayId}/start
 * Starts (and, if needed, creates) the active trip for the driver's order.
 * Creates the trips row plus trip_items/trip_stops via the service role, since
 * the trips RLS deliberately exposes no write path to authenticated users.
 * Idempotent: an already-active trip for the order is returned as-is.
 */
router.put('/:id/start', authenticate, userLimiter, async (req, res) => {
  try {
    const ctx = await findTripContext(req.params.id);
    if (ctx.error) return res.status(500).json({ error: 'Internal Server Error', details: ctx.error.message });

    if (ctx.trip) {
      if (!canAccessTrip(req.user, ctx.trip)) {
        return res.status(403).json({ error: 'Access Denied: Trip does not belong to you.' });
      }
      return res.json(ctx.trip);
    }

    const order = ctx.order;
    if (!order) return res.status(404).json({ error: 'Order not found. Cannot start trip.' });
    if (!canAccessOrder(req.user, order)) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }
    if (!order.driver_id) return res.status(409).json({ error: 'No driver assigned to this order.' });
    if (['cancelled', 'delivered', 'payment_released'].includes(order.status)) {
      return res.status(409).json({ error: `Order cannot be started: status is ${order.status}.` });
    }

    // A driver can only have one active trip at a time (partial unique index).
    const { data: existingActive, error: existingErr } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('driver_id', order.driver_id)
      .eq('status', 'active')
      .maybeSingle();
    if (existingErr) return res.status(500).json({ error: 'Failed to check existing trips.', details: existingErr.message });
    if (existingActive) return res.status(409).json({ error: 'You already have an active trip.' });

    const tripDisplayId = `TX-${order.order_display_id}`;

    const { data: customer, error: customerErr } = await supabaseAdmin
      .from('profiles')
      .select('full_name')
      .eq('id', order.customer_id)
      .maybeSingle();
    if (customerErr) return res.status(500).json({ error: 'Failed to resolve customer.', details: customerErr.message });
    const customerName = customer?.full_name || 'Customer';

    const earnings = order.total_amount || 0;
    const routeLabel = `${order.pickup_address} → ${order.drop_address}`;

    const { data: createdTrip, error: tripInsertErr } = await supabaseAdmin
      .from('trips')
      .insert({
        trip_display_id: tripDisplayId,
        driver_id: order.driver_id,
        order_id: order.id,
        route_label: routeLabel,
        status: 'active',
        trip_date: order.pickup_date || new Date().toISOString().slice(0, 10),
        base_freight: order.base_freight || 0,
        total_earnings: earnings,
      })
      .select('*')
      .maybeSingle();

    if (tripInsertErr) {
      logger.error('[Trips] Failed to create trip:', tripInsertErr.message);
      return res.status(409).json({ error: 'Failed to create trip. A trip for this order may already exist.' });
    }

    const { error: itemsErr } = await supabaseAdmin.from('trip_items').insert({
      trip_display_id: tripDisplayId,
      customer_name: customerName,
      goods: order.goods_type,
      destination: order.drop_address,
      earnings,
      is_delivered: false,
      sort_order: 1,
    });
    if (itemsErr) logger.error('[Trips] Failed to create trip items:', itemsErr.message);

    const { error: stopsErr } = await supabaseAdmin.from('trip_stops').insert({
      trip_display_id: tripDisplayId,
      customer_name: customerName,
      route_label: routeLabel,
      goods: order.goods_type,
      drop_location: order.drop_address,
      tonnes: order.weight_tonnes != null ? String(order.weight_tonnes) : null,
      status_label: 'In Progress',
      sort_order: 1,
      is_current: true,
      is_completed: false,
    });
    if (stopsErr) logger.error('[Trips] Failed to create trip stops:', stopsErr.message);

    return res.status(201).json(createdTrip);
  } catch (err) {
    logger.error('[Trips] Start trip error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

/**
 * PUT /api/trips/{tripDisplayId}/stops/{stopId}/complete
 * Marks a stop delivered, advances the current stop, and reports whether every
 * stop on the trip is now complete. Driver must own the trip.
 */
router.put('/:id/stops/:stopId/complete', authenticate, userLimiter, async (req, res) => {
  try {
    if (!UUID_REGEX.test(req.params.stopId)) {
      return res.status(400).json({ error: 'Invalid stop id.' });
    }

    const ctx = await findTripContext(req.params.id);
    if (ctx.error) return res.status(500).json({ error: 'Internal Server Error', details: ctx.error.message });
    const owned = await requireOwnedTrip(req, res, ctx);
    if (owned.error) return res.status(owned.error.status).json(owned.error.body);

    const { data: stop, error: stopErr } = await supabaseAdmin
      .from('trip_stops')
      .select('*')
      .eq('id', req.params.stopId)
      .eq('trip_display_id', owned.trip.trip_display_id)
      .maybeSingle();
    if (stopErr) return res.status(500).json({ error: 'Failed to fetch stop.', details: stopErr.message });
    if (!stop) return res.status(404).json({ error: 'Stop not found on this trip.' });
    if (stop.is_completed) return res.status(409).json({ error: 'Stop is already completed.' });

    const { error: updateErr } = await supabaseAdmin
      .from('trip_stops')
      .update({
        is_completed: true,
        is_current: false,
        status_label: 'Delivered',
        updated_at: new Date().toISOString(),
      })
      .eq('id', stop.id);
    if (updateErr) return res.status(500).json({ error: 'Failed to complete stop.', details: updateErr.message });

    // Advance the current-stop marker to the next uncompleted stop.
    const { data: nextStops, error: nextErr } = await supabaseAdmin
      .from('trip_stops')
      .select('id')
      .eq('trip_display_id', owned.trip.trip_display_id)
      .eq('is_completed', false)
      .order('sort_order', { ascending: true })
      .limit(1);
    if (nextErr) {
      logger.error('[Trips] Failed to resolve next stop:', nextErr.message);
    } else if (nextStops && nextStops.length > 0) {
      await supabaseAdmin
        .from('trip_stops')
        .update({
          is_current: true,
          status_label: 'In Progress',
          updated_at: new Date().toISOString(),
        })
        .eq('id', nextStops[0].id);
    }

    const { data: stops, error: stopsErr } = await supabaseAdmin
      .from('trip_stops')
      .select('*')
      .eq('trip_display_id', owned.trip.trip_display_id)
      .order('sort_order', { ascending: true });
    if (stopsErr) return res.status(500).json({ error: 'Failed to fetch updated stops.', details: stopsErr.message });

    const allCompleted = (stops || []).length > 0 && (stops || []).every((s) => s.is_completed);
    return res.json({ stops: stops || [], allCompleted });
  } catch (err) {
    logger.error('[Trips] Complete stop error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
