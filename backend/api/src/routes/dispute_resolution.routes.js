import express from 'express';
import { ethers } from 'ethers';
import { supabaseAdmin } from '../config/db.js';
import logger from '../middleware/logger.js';
import { requireApiKey } from '../middleware/apiKey.js';
import { escrowRelease } from '../services/escrow.js';

const router = express.Router();

export function sanitizeBookingId(bookingId) {
  if (!bookingId) return null;
  const str = String(bookingId).trim();
  if (/[\s,"'();:]/.test(str)) return null;
  if (/^(0x[0-9a-fA-F]+|\d+|[0-9a-fA-F-]{36}|#?[A-Za-z0-9_-]+)$/.test(str)) {
    return str;
  }
  return null;
}

export function normalizeBookingId(bookingId) {
  const clean = sanitizeBookingId(bookingId);
  if (!clean) return null;
  if (clean.startsWith('0x')) return clean.toLowerCase();
  if (/^\d+$/.test(clean)) {
    try {
      return ethers.toBeHex(BigInt(clean), 32).toLowerCase();
    } catch (_) {
      return clean;
    }
  }
  return clean;
}

export async function findOrderByAnyBookingId(bookingId) {
  const cleanId = sanitizeBookingId(bookingId);
  if (!cleanId) return null;
  const normalizedHex = normalizeBookingId(cleanId);
  const { data: order } = await supabaseAdmin
    .from('orders')
    .select('id, order_display_id, escrow_booking_id, payment_status, escrow_status, escalated_at, dispute_n8n_triggered_at, customer_id, driver_id')
    .or(`escrow_booking_id.eq.${normalizedHex},escrow_booking_id.eq.${cleanId},order_display_id.eq.${cleanId},id.eq.${cleanId}`)
    .maybeSingle();
  return order;
}

/**
 * PATCH /api/orders/dispute-n8n-trigger
 * Idempotency guard for n8n dispute workflow.
 * Executes atomic conditional update: SET dispute_n8n_triggered_at = now() WHERE dispute_n8n_triggered_at IS NULL.
 */
router.patch('/orders/dispute-n8n-trigger', requireApiKey, async (req, res) => {
  try {
    const rawBookingId = req.body.bookingId || req.body.orderId;
    const cleanId = sanitizeBookingId(rawBookingId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid or missing bookingId' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for bookingId ${cleanId}` });
    }

    // Conditional atomic update
    const nowIso = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update({ dispute_n8n_triggered_at: nowIso, updated_at: nowIso })
      .eq('id', order.id)
      .is('dispute_n8n_triggered_at', null)
      .select('id, dispute_n8n_triggered_at');

    if (error) {
      logger.error(`[DisputeRoutes] Idempotency patch error: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    if (!updated || updated.length === 0) {
      logger.info(`[DisputeRoutes] Workflow already triggered for order ${order.id} — skipping`);
      return res.status(200).json({ alreadyExisted: true, orderId: order.id });
    }

    logger.info(`[DisputeRoutes] Workflow trigger recorded for order ${order.id}`);
    return res.status(200).json({ success: true, alreadyExisted: false, orderId: order.id });
  } catch (err) {
    logger.error(`[DisputeRoutes] Error in dispute-n8n-trigger: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/orders/check-otp
 * Helper endpoint to verify delivery OTP status.
 */
router.get('/orders/check-otp', requireApiKey, async (req, res) => {
  try {
    const rawBookingId = req.query.bookingId || req.query.orderId;
    const cleanId = sanitizeBookingId(rawBookingId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid or missing bookingId' });
    }
    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const { data: otpRow } = await supabaseAdmin
      .from('delivery_otps')
      .select('id, verified')
      .eq('order_id', order.id)
      .eq('verified', true)
      .maybeSingle();

    return res.status(200).json({
      orderId: order.id,
      otpVerified: !!otpRow,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/webhooks/n8n/dispute-trigger
 * Webhook triggered by n8n or backend timer when delivery remains unconfirmed for 2 hours.
 */
router.post('/webhooks/n8n/dispute-trigger', requireApiKey, async (req, res) => {
  try {
    const rawId = req.body.orderId || req.body.bookingId;
    const cleanId = sanitizeBookingId(rawId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid or missing orderId / bookingId' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for ${cleanId}` });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update({ dispute_n8n_triggered_at: nowIso, updated_at: nowIso })
      .eq('id', order.id)
      .is('dispute_n8n_triggered_at', null)
      .select('id, dispute_n8n_triggered_at');

    if (error) {
      logger.error(`[DisputeRoutes] Webhook dispute-trigger update failed: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    if (!updated || updated.length === 0) {
      return res.status(200).json({ alreadyTriggered: true, orderId: order.id });
    }

    logger.info(`[DisputeRoutes] Webhook dispute-trigger initiated for order ${order.id}`);
    return res.status(200).json({
      success: true,
      alreadyTriggered: false,
      orderId: order.id,
      triggeredAt: nowIso,
    });
  } catch (err) {
    logger.error(`[DisputeRoutes] Error in webhook dispute-trigger: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/internal/dispute-evidence/:bookingId or /:orderId
 * Collects GPS trail & OTP evidence for n8n decision node.
 */
async function getDisputeEvidenceHandler(req, res) {
  try {
    const rawId = req.params.orderId || req.params.bookingId;
    const cleanId = sanitizeBookingId(rawId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid orderId or bookingId parameter' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for ${cleanId}` });
    }

    const { data: otpRow } = await supabaseAdmin
      .from('delivery_otps')
      .select('id, verified')
      .eq('order_id', order.id)
      .eq('verified', true)
      .maybeSingle();

    const { data: gpsRows } = await supabaseAdmin
      .from('driver_locations')
      .select('id, latitude, longitude, created_at')
      .eq('order_id', order.id)
      .limit(10);

    return res.status(200).json({
      orderId: order.id,
      orderDisplayId: order.order_display_id,
      otpVerified: !!otpRow,
      gpsValid: Array.isArray(gpsRows) && gpsRows.length > 0,
      gpsPointsCount: Array.isArray(gpsRows) ? gpsRows.length : 0,
    });
  } catch (err) {
    logger.error(`[DisputeRoutes] Error collecting evidence: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
}

router.get('/internal/dispute-evidence/:bookingId', requireApiKey, getDisputeEvidenceHandler);
router.get('/internal/dispute-evidence/:orderId', requireApiKey, getDisputeEvidenceHandler);


/**
 * POST /api/escrow/release
 * Releases escrow funds on-chain for the resolved order.
 */
router.post('/escrow/release', requireApiKey, async (req, res) => {
  try {
    const rawBookingId = req.body.bookingId || req.body.orderId;
    const cleanId = sanitizeBookingId(rawBookingId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid or missing bookingId' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for ${cleanId}` });
    }

    const result = await escrowRelease(order.order_display_id);
    logger.info(`[DisputeRoutes] Escrow release executed for ${order.order_display_id}`);
    return res.status(200).json({ success: true, result });
  } catch (err) {
    logger.error(`[DisputeRoutes] Escrow release error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/dispute/status/:bookingId
 * Returns status metrics for an order under dispute.
 */
router.get('/dispute/status/:bookingId', requireApiKey, async (req, res) => {
  try {
    const cleanId = sanitizeBookingId(req.params.bookingId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid bookingId parameter' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for ${cleanId}` });
    }

    return res.status(200).json({
      orderId: order.id,
      orderDisplayId: order.order_display_id,
      paymentStatus: order.payment_status,
      escrowStatus: order.escrow_status,
      escalatedAt: order.escalated_at,
      disputeTriggeredAt: order.dispute_n8n_triggered_at,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * PATCH /api/dispute/escalate
 * Sets orders.escalated_at = now() for manual Ops review.
 */
router.patch('/dispute/escalate', requireApiKey, async (req, res) => {
  try {
    const rawBookingId = req.body.bookingId || req.body.orderId;
    const cleanId = sanitizeBookingId(rawBookingId);
    if (!cleanId) {
      return res.status(400).json({ error: 'Invalid or missing bookingId' });
    }

    const order = await findOrderByAnyBookingId(cleanId);
    if (!order) {
      return res.status(404).json({ error: `Order not found for ${cleanId}` });
    }

    const nowIso = new Date().toISOString();
    const { data: updated, error } = await supabaseAdmin
      .from('orders')
      .update({ escalated_at: nowIso, updated_at: nowIso })
      .eq('id', order.id)
      .select('id, escalated_at');

    if (error) {
      logger.error(`[DisputeRoutes] Escalate error: ${error.message}`);
      return res.status(500).json({ error: error.message });
    }

    logger.info(`[DisputeRoutes] Order ${order.id} escalated for Ops review`);
    return res.status(200).json({ success: true, escalatedAt: nowIso, orderId: order.id });
  } catch (err) {
    logger.error(`[DisputeRoutes] Error in escalate handler: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

export default router;
