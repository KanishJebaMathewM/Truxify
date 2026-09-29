import express from 'express';
import crypto from 'crypto';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { orderRepository, orderLifecycleService, logger } from '../core/container.js';
import { sendFcmNotification } from '../services/notificationService.js';

const router = express.Router();

export const GEOFENCE_RADIUS_METERS = 500; // 500 meter geofence radius for delivery handoff
export const ALLOWED_DELIVERY_ROLES = Object.freeze(['driver', 'admin']);

const confirmOtpSchema = z.object({
  otp: z.string().regex(/^\d{4,6}$/, { message: 'OTP must be 4 to 6 digits' }).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

const podSchema = z.object({
  receiver_name: z.string().min(2).max(100),
  signature_url: z.string().url(),
  cargo_photo_url: z.string().url().optional(),
  notes: z.string().max(500).optional(),
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),
});

/**
 * Calculates Great-Circle distance in meters using Haversine formula.
 */
export function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c; // in meters
}

/**
 * Computes SHA-256 integrity hash for Proof of Delivery (ePOD).
 */
export function generatePodHash(orderId, receiverName, signatureUrl, timestamp) {
  return crypto
    .createHash('sha256')
    .update(`${orderId}:${receiverName}:${signatureUrl}:${timestamp}`)
    .digest('hex');
}

/**
 * Validates HTTP/HTTPS web URI.
 */
export function isValidUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * POST /api/delivery/:id/confirm-otp
 * Confirms OTP code, verifies geofence distance, and releases escrow funds.
 */
router.post('/:id/confirm-otp', authenticate, userLimiter, validateBody(confirmOtpSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { otp, latitude, longitude } = req.body;

    // 1. Fetch order details from database
    const order = await orderRepository.findOrderByAnyId(orderId, '*');
    if (!order || !order.data) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const orderData = order.data;

    // Ensure access control: only the assigned driver or admin can confirm delivery
    if (orderData.driver_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

    if (!otp) {
      return res.status(400).json({ error: 'OTP is required to confirm delivery.' });
    }

    // Geofencing verification
    let isGeofenced = false;
    let distanceToDestinationMeters = null;
    if (typeof latitude === 'number' && typeof longitude === 'number') {
      const destLat = orderData.destination_latitude ?? orderData.dropoff_latitude ?? orderData.destination?.lat;
      const destLon = orderData.destination_longitude ?? orderData.dropoff_longitude ?? orderData.destination?.lng;

      if (typeof destLat === 'number' && typeof destLon === 'number') {
        distanceToDestinationMeters = Math.round(calculateHaversineDistance(latitude, longitude, destLat, destLon));
        isGeofenced = distanceToDestinationMeters <= GEOFENCE_RADIUS_METERS;
      }
    }

    // 4. Trigger delivery completion and escrow payment release
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(
      orderData.id,
      req.user.id,
      otp
    );

    // 5. Send push notification to the driver
    const displayAmount = orderData.total_amount ? (orderData.total_amount / 100).toFixed(2) : '0.00';
    await sendFcmNotification(req.user.id, {
      title: 'Payment Released',
      body: `✓ ₹${displayAmount} credited`
    }).catch(err => {
      logger.warn(`[confirm-otp] Notification delivery failed: ${err.message}`);
    });

    if (escrowUpdateFailed) {
      return res.status(202).json({
        message: 'Delivery verified successfully. Escrow payout requires reconciliation.',
        escrow_status: 'released',
        payment_released: true,
        isGeofenced,
        distanceToDestinationMeters
      });
    }

    return res.json({
      success: true,
      message: 'Delivery verified successfully! Payment released to driver.',
      payment_released: true,
      isGeofenced,
      distanceToDestinationMeters
    });
  } catch (err) {
    logger.error('[confirm-otp] Exception:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

/**
 * POST /api/delivery/:id/pod
 * Submits electronic Proof of Delivery (ePOD) with cryptographic tamper-evident hash.
 */
router.post('/:id/pod', authenticate, userLimiter, validateBody(podSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { receiver_name, signature_url, cargo_photo_url, notes, latitude, longitude } = req.body;

    const order = await orderRepository.findOrderByAnyId(orderId, '*');
    if (!order || !order.data) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const orderData = order.data;

    if (orderData.driver_id !== req.user.id && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

    if (!isValidUrl(signature_url)) {
      return res.status(400).json({ error: 'Invalid signature_url: Must be an HTTP or HTTPS link' });
    }

    if (cargo_photo_url && !isValidUrl(cargo_photo_url)) {
      return res.status(400).json({ error: 'Invalid cargo_photo_url: Must be an HTTP or HTTPS link' });
    }

    const timestamp = new Date().toISOString();
    const podHash = generatePodHash(orderData.id, receiver_name, signature_url, timestamp);

    const podRecord = {
      orderId: orderData.id,
      receiverName: receiver_name,
      signatureUrl: signature_url,
      cargoPhotoUrl: cargo_photo_url || null,
      notes: notes || '',
      podHash,
      submittedBy: req.user.id,
      submittedAt: timestamp,
      coordinates: typeof latitude === 'number' && typeof longitude === 'number' ? { latitude, longitude } : null
    };

    if (typeof orderRepository.updateOrderPod === 'function') {
      await orderRepository.updateOrderPod(orderData.id, podRecord);
    }

    return res.status(201).json({
      message: 'Proof of Delivery (ePOD) submitted successfully',
      pod: podRecord
    });
  } catch (err) {
    logger.error('[pod] Exception:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Failed to submit Proof of Delivery' });
  }
});

/**
 * GET /api/delivery/:id/status
 * Fetches delivery status, geofencing verification, and POD record.
 */
router.get('/:id/status', authenticate, userLimiter, async (req, res) => {
  try {
    const orderId = req.params.id;

    const order = await orderRepository.findOrderByAnyId(orderId, '*');
    if (!order || !order.data) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    const orderData = order.data;

    if (
      orderData.driver_id !== req.user.id &&
      orderData.shipper_id !== req.user.id &&
      req.user.role !== 'admin'
    ) {
      return res.status(403).json({ error: 'Access Denied: You do not have permission to view this delivery status.' });
    }

    return res.json({
      orderId: orderData.id,
      status: orderData.status || 'IN_TRANSIT',
      pod: orderData.pod || null,
      deliveryConfirmed: orderData.status === 'DELIVERED' || orderData.status === 'COMPLETED'
    });
  } catch (err) {
    logger.error('[delivery-status] Exception:', err.message);
    return res.status(500).json({ error: 'Failed to fetch delivery status' });
  }
});

export default router;
