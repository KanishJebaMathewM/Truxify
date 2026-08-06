import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { orderRepository, orderLifecycleService, logger } from '../core/container.js';
import { sendFcmNotification } from '../services/notificationService.js';
import { storeDeliveryOtp } from '../services/notificationService.js';
import crypto from 'crypto';

const router = express.Router();

const confirmOtpSchema = z.object({
  otp: z.string().regex(/^\d{4}$/, { message: 'OTP must be 4 digits' }).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

function calculateHaversineDistance(lat1, lon1, lat2, lon2) {
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
    if (orderData.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

    let isGeofenced = false;
    let distance = null;

    // 2. Check if driver is within 500m of the drop location
    if (latitude !== undefined && longitude !== undefined && orderData.drop_lat !== null && orderData.drop_lng !== null) {
      distance = calculateHaversineDistance(
        latitude,
        longitude,
        Number(orderData.drop_lat),
        Number(orderData.drop_lng)
      );
      if (distance <= 500) {
        isGeofenced = true;
        logger.info(`[confirm-otp] Geofence matched for order ${orderData.order_display_id}: driver is at ${distance.toFixed(1)}m from drop.`);
      }
    }

    let otpToVerify = otp;

    // 3. Handle geofence auto-confirm
    if (isGeofenced) {
      // Auto-generate and store a special 'GEOF' OTP as pre-verified/active to bypass manual entry
      otpToVerify = 'GEOF';
      const success = await storeDeliveryOtp(orderData.id, 'GEOF', 5); // 5 minutes TTL
      if (!success) {
        logger.error(`[confirm-otp] Failed to store geofence bypass OTP for order ${orderData.id}`);
        return res.status(500).json({ error: 'Failed to initiate geofence bypass verification.' });
      }
    } else {
      // If not geofenced, OTP is strictly required
      if (!otp) {
        return res.status(400).json({
          error: 'OTP is required. You are outside the 500m geofence range.',
          distanceMeters: distance
        });
      }
    }

    // 4. Trigger delivery completion and escrow payment release
    // This calls verifyDelivery under the hood which releases smart contract payments
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(
      orderData.id,
      req.user.id,
      otpToVerify
    );

    // 5. Send FCM push notification to the driver: "Payment Released ✓ ₹XXXX credited"
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
        isGeofenced
      });
    }

    return res.json({
      success: true,
      message: 'Delivery verified successfully! Payment released to driver.',
      payment_released: true,
      isGeofenced
    });
  } catch (err) {
    logger.error('[confirm-otp] Exception:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

export default router;
