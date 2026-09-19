import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import coldChainAnomalyService from '../services/coldChainAnomalyService.js';
import { paramIdSchema } from '../validation/requestSchemas.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateParams } from '../middleware/validate.js';
import { z } from 'zod';


/**
 * @openapi
 * components:
 *   securitySchemes:
 *     BearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     IotTelemetryInput:
 *       type: object
 *       required: [temperature]
 *       properties:
 *         temperature:
 *           type: number
 *           format: double
 *           minimum: -100
 *           maximum: 200
 *           description: Temperature reading in degrees Celsius.
 *     IotTelemetryAnalysis:
 *       type: object
 *       additionalProperties: true
 *     IotTelemetryResponse:
 *       type: object
 *       required: [success, message]
 *       properties:
 *         success: { type: boolean, example: true }
 *         message: { type: string, example: Telemetry recorded }
 *         analysis: { $ref: '#/components/schemas/IotTelemetryAnalysis' }
 *     IotTelemetryRecord:
 *       type: object
 *       properties:
 *         load_id: { type: string, format: uuid }
 *         temperature: { type: number, format: double }
 *         recorded_at: { type: string, format: date-time }
 *       additionalProperties: true
 *     IotError:
 *       type: object
 *       properties:
 *         error: { type: string }
 * /api/iot/telemetry/{id}:
 *   post:
 *     summary: Record cold-chain telemetry
 *     description: Records a temperature reading for a refrigerated load. Access is limited to authorized customers, assigned drivers, provisioned IoT devices, or administrators.
 *     tags: [IoT Telemetry]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, description: Load UUID, schema: { type: string, format: uuid } }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { $ref: '#/components/schemas/IotTelemetryInput' }
 *     responses:
 *       '201':
 *         description: Telemetry recorded
 *         content: { application/json: { schema: { $ref: '#/components/schemas/IotTelemetryResponse' } } }
 *       '400': { description: Invalid payload or load is not refrigerated, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *       '403': { description: Caller is not authorized for the load, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *       '404': { description: Load not found, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *       '500': { description: Database or internal server error, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *   get:
 *     summary: Get cold-chain telemetry history
 *     description: Returns the latest 20 temperature readings for an authorized load.
 *     tags: [IoT Telemetry]
 *     security: [{ BearerAuth: [] }]
 *     parameters:
 *       - { in: path, name: id, required: true, description: Load UUID, schema: { type: string, format: uuid } }
 *     responses:
 *       '200':
 *         description: Latest telemetry readings
 *         content: { application/json: { schema: { type: array, items: { $ref: '#/components/schemas/IotTelemetryRecord' } } } }
 *       '400': { description: Invalid load ID }
 *       '403': { description: Caller is not authorized for the load, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *       '404': { description: Load not found, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 *       '500': { description: Database or internal server error, content: { application/json: { schema: { $ref: '#/components/schemas/IotError' } } } }
 */

const router = express.Router();

const telemetrySchema = z.object({
  temperature: z.number().finite().min(-100).max(200)
});
const telemetryHistoryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: safeIpKeyGenerator,
  store: createStore('rl:iot-telemetry-history:'),
  message: { error: 'Rate limit exceeded', retryAfter: 900 },
});

// ============================================================================
// 1. POST TELEMETRY DATA (IoT)
// POST /api/iot/telemetry/:id
// ============================================================================
router.post('/telemetry/:id', telemetryHistoryLimiter, authenticate, validateParams(paramIdSchema), async (req, res) => {
  try {
    const parseResult = telemetrySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parseResult.error });
    }
    
    const loadId = req.params.id;
    const { temperature } = parseResult.data;

    // Check if load exists and has cold chain enabled.
    // load_offers is RLS-protected (anon revoked), so this read must use the
    // service-role client; ownership is enforced below against req.user.
    const { data: load, error: loadErr } = await supabaseAdmin
      .from('load_offers')
      .select('requires_refrigeration, target_temperature_min, target_temperature_max, customer_id, order_display_id')
      .eq('id', loadId)
      .maybeSingle();

    if (loadErr) {
      logger.error({ event: 'IOT_LOAD_FETCH_ERROR', requestId: req.requestId || req.id, loadId, error: loadErr && (loadErr.message || String(loadErr)) }, 'Failed to fetch load for telemetry');
      return res.status(500).json({ error: 'Database error' });
    }

    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    if (!load.requires_refrigeration) {
      return res.status(400).json({ error: 'Load does not require refrigeration' });
    }

    // Admins may always ingest telemetry.
    // Provisioned IoT devices may ingest telemetry if they map to this specific load.
    // Everyone else must mirror GET authorization: the load owner OR the
    // assigned driver. The driver is the party physically carrying the load
    // and the only person able to record cold-chain readings in transit.
    if (req.user.role !== 'admin') {
      let isAuthorized = false;

      if (req.user.role === 'iot_device') {
        isAuthorized = load.device_id === req.user.id;
        // Look up the device-to-load assignment via the iot_device_loads table.
        // The previous check (device_id === load_id) was semantically wrong since
        // a device UUID and a load UUID are never meaningfully comparable.
        const { data: assignment, error: assignmentErr } = await supabaseAdmin
          .from('iot_device_loads')
          .select('id')
          .eq('device_id', req.user.id)
          .eq('load_id', loadId)
          .maybeSingle();
        if (assignmentErr) {
          logger.error({ event: 'IOT_DEVICE_LOAD_FETCH_ERROR', loadId, error: assignmentErr && (assignmentErr.message || String(assignmentErr)) }, 'Failed to resolve device-to-load assignment');
          return res.status(500).json({ error: 'Authorization error' });
        }
        isAuthorized = !!assignment;
        // A device may only report telemetry for a load whose order is still in
        // an active (in-transit) state, mirroring the driver authorization below.
        if (isAuthorized && load.order_display_id) {
          const { data: order } = await supabaseAdmin
            .from('orders')
            .select('driver_id')
            .eq('order_display_id', load.order_display_id)
            .in('status', ['truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving', 'delivered'])
            .maybeSingle();
          isAuthorized = !!order;
        }
      } else {
        isAuthorized = load.customer_id === req.user.id;
        if (!isAuthorized && load.order_display_id) {
          const { data: order } = await supabaseAdmin
            .from('orders')
            .select('driver_id')
            .eq('order_display_id', load.order_display_id)
            .in('status', ['truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving', 'delivered'])
            .maybeSingle();
          isAuthorized = order?.driver_id === req.user.id;
        }
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Access denied for this load' });
      }
    }

    // Check if out of range
    const isOutOfRange = (load.target_temperature_min !== null && temperature < load.target_temperature_min) ||
                         (load.target_temperature_max !== null && temperature > load.target_temperature_max);

    // Resolve the previous (pre-insert) frame BEFORE writing the current one,
    // so the transition check compares the new reading against the true prior
    // reading rather than the row we are about to insert. Otherwise the
    // previous-frame lookup returns the just-inserted row and the alert never
    // fires on the out-of-range transition.
    let prevOutOfRange = false;
    let prevErr = null;
    if (isOutOfRange) {
      logger.warn(`Cold chain violation on load ${loadId}: temp ${temperature}°C out of range [${load.target_temperature_min}, ${load.target_temperature_max}]`);

      const { data: prevTelemetry, error: pErr } = await supabaseAdmin
        .from('temperature_telemetry')
        .select('temperature')
        .eq('load_id', loadId)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      prevErr = pErr;

      const prevTemp = prevTelemetry?.temperature;
      prevOutOfRange = prevTemp !== undefined && prevTemp !== null &&
        ((load.target_temperature_min !== null && prevTemp < load.target_temperature_min) ||
         (load.target_temperature_max !== null && prevTemp > load.target_temperature_max));
    }

    // Insert telemetry (service-role client: RLS only permits service_role to
    // write temperature_telemetry, so the backend must use supabaseAdmin).
    const { error: insertErr } = await supabaseAdmin
      .from('temperature_telemetry')
      .insert({
        load_id: loadId,
        temperature: temperature
      });

    if (insertErr) {
      logger.error({ event: 'IOT_TELEMETRY_INSERT_ERROR', requestId: req.requestId || req.id, loadId, error: insertErr && (insertErr.message || String(insertErr)) }, 'Failed to insert telemetry');
      return res.status(500).json({ error: 'Database error' });
    }

    // Evaluate sliding-window cumulative excursions & MKT degradation
    const analysis = await coldChainAnomalyService.processTelemetry({
      loadId,
      orderId: load.order_display_id,
      temperature,
      targetMin: load.target_temperature_min,
      targetMax: load.target_temperature_max,
      customerId: load.customer_id,
      driverId: req.user?.id,
    });

    return res.status(201).json({
      success: true,
      message: 'Telemetry recorded',
      analysis,
    });
  } catch (err) {
    logger.error({ event: 'IOT_TELEMETRY_ERROR', requestId: req.requestId || req.id, error: err && (err.message || String(err)) }, 'Internal server error in IoT telemetry route');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// =====================================================================
// 2. GET TELEMETRY DATA
// GET /api/iot/telemetry/:id
// =====================================================================
router.get('/telemetry/:id', telemetryHistoryLimiter, authenticate, validateParams(paramIdSchema), async (req, res) => {
  const loadId = req.params.id;

  try {
    const { data: load, error: loadErr } = await supabaseAdmin
      .from('load_offers')
      .select('id, customer_id, device_id, order_display_id, required_temp_min, required_temp_max')
      .eq('id', loadId)
      .maybeSingle();

    if (loadErr) {
      logger.error({ event: 'IOT_AUTH_LOAD_FETCH_ERROR', requestId: req.requestId || req.id, loadId, error: loadErr && (loadErr.message || String(loadErr)) }, 'Failed to fetch load for telemetry authorization');
      return res.status(500).json({ error: 'Database error' });
    }

    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    if (req.user.role !== 'admin') {
      let isAuthorized = load.customer_id === req.user.id;

      if (!isAuthorized && load.order_display_id) {
        const { data: order } = await supabaseAdmin
          .from('orders')
          .select('driver_id')
          .eq('order_display_id', load.order_display_id)
          .in('status', ['truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving', 'delivered'])
          .maybeSingle();

        isAuthorized = order?.driver_id === req.user.id;
      }

      if (!isAuthorized && req.user.role === 'iot_device') {
        isAuthorized = load.device_id === req.user.id;
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Access denied for this load telemetry' });
      }
    }

    const { data, error } = await supabaseAdmin
      .from('temperature_telemetry')
      .select('*')
      .eq('load_id', loadId)
      .order('recorded_at', { ascending: false })
      .limit(20);
      
    if (error) {
      return res.status(500).json({ error: 'Failed to fetch telemetry' });
    }
    return res.json(data);
  } catch (err) {
    logger.error({ event: 'IOT_TELEMETRY_FETCH_ERROR', requestId: req.requestId || req.id, error: err && (err.message || String(err)) }, 'Internal server error in IoT telemetry fetch');
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
