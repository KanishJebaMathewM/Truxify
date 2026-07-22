import express from 'express';
import { supabase } from '../config/db.js';
import logger from '../middleware/logger.js';
import { paramIdSchema } from '../validation/requestSchemas.js';
import { validateParams } from '../middleware/validate.js';
import { z } from 'zod';

const router = express.Router();

const telemetrySchema = z.object({
  temperature: z.number()
});

// ============================================================================
// 1. POST TELEMETRY DATA (IoT)
// POST /api/iot/telemetry/:id
// ============================================================================
router.post('/telemetry/:id', validateParams(paramIdSchema), async (req, res) => {
  try {
    const parseResult = telemetrySchema.safeParse(req.body);
    if (!parseResult.success) {
      return res.status(400).json({ error: 'Invalid payload', details: parseResult.error });
    }
    
    const loadId = req.params.id;
    const { temperature } = parseResult.data;

    // Check if load exists and has cold chain enabled
    const { data: load, error: loadErr } = await supabase
      .from('load_offers')
      .select('requires_refrigeration, target_temperature_min, target_temperature_max, customer_id')
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

    // Insert telemetry
    const { error: insertErr } = await supabase
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
      
      await supabase.from('notifications').insert({
        user_id: load.customer_id,
        title: 'Temperature Alert',
        message: `Your cargo (Load ${loadId}) is out of the safe temperature range. Current temp: ${temperature}°C.`,
        type: 'alert'
      }).catch(err => logger.error('Failed to send notification:', err));
    }

    return res.status(201).json({ success: true, message: 'Telemetry recorded' });
  } catch (err) {
    logger.error('Internal server error in IoT telemetry route:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================================================
// 2. GET TELEMETRY DATA
// GET /api/iot/telemetry/:id
// ============================================================================
router.get('/telemetry/:id', validateParams(paramIdSchema), async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('temperature_telemetry')
      .select('*')
      .eq('load_id', req.params.id)
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
