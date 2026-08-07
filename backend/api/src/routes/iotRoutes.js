import express from 'express';
import rateLimit from 'express-rate-limit';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { paramIdSchema } from '../validation/requestSchemas.js';
import { authenticate } from '../middleware/auth.js';
import { safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { validateParams } from '../middleware/validate.js';
import { z } from 'zod';

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
      logger.error('Failed to fetch load for telemetry:', loadErr);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!load) {
      return res.status(404).json({ error: 'Load not found' });
    }

    if (!load.requires_refrigeration) {
      return res.status(400).json({ error: 'Load does not require refrigeration' });
    }

    // Mirror GET authorization: allow the load owner OR the assigned driver.
    // The driver is the party physically carrying the load and the only person
    // able to record cold-chain readings in transit.
    if (req.user.role !== 'admin') {
      let isAuthorized = load.customer_id === req.user.id;
      if (!isAuthorized && load.order_display_id) {
        const { data: order } = await supabase
          .from('orders')
          .select('driver_id')
          .eq('order_display_id', load.order_display_id)
          .in('status', ['truck_assigned', 'en_route_pickup', 'picked_up', 'in_transit'])
          .maybeSingle();
        isAuthorized = order?.driver_id === req.user.id;
      }
      if (!isAuthorized) {
        return res.status(403).json({ error: 'Access denied for this load' });
      }
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
      logger.error('Failed to insert telemetry:', insertErr);
      return res.status(500).json({ error: 'Database error' });
    }

    // Check if out of range
    const isOutOfRange = (load.target_temperature_min !== null && temperature < load.target_temperature_min) ||
                         (load.target_temperature_max !== null && temperature > load.target_temperature_max);

    if (isOutOfRange) {
      logger.warn(`Cold chain violation on load ${loadId}: temp ${temperature}°C out of range [${load.target_temperature_min}, ${load.target_temperature_max}]`);
      
      // In a full implementation, we might check if it's been out of range for 15 mins.
      // For MVP, we'll insert a notification immediately if it's not already spammed.
      // We can use the existing notifications table or system if one exists, but for now we'll just log.
      
      await supabaseAdmin.from('notifications').insert({
        user_id: load.customer_id,
        title: 'Temperature Alert',
        body: `Your cargo (Load ${loadId}) is out of the safe temperature range. Current temp: ${temperature}°C.`,
        notif_type: 'system',
        metadata: {
          load_id: loadId,
          temperature,
          target_temperature_min: load.target_temperature_min,
          target_temperature_max: load.target_temperature_max
        }
      }).catch(err => logger.error('Failed to send notification:', err));
    }

    return res.status(201).json({ success: true, message: 'Telemetry recorded' });
  } catch (err) {
    logger.error('Internal server error in IoT telemetry route:', err);
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
      .select('customer_id, order_display_id')
      .eq('id', loadId)
      .maybeSingle();

    if (loadErr) {
      logger.error('Failed to fetch load for telemetry authorization:', loadErr);
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
          .in('status', ['truck_assigned', 'en_route_pickup', 'picked_up', 'in_transit'])
          .maybeSingle();

        isAuthorized = order?.driver_id === req.user.id;
      }

      if (!isAuthorized) {
        return res.status(403).json({ error: 'Access denied' });
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
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
