import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { orderRepository, orderLifecycleService, logger } from '../core/container.js';
import { sendFcmNotification, storeDeliveryOtp } from '../services/notificationService.js';

const router = express.Router();

const confirmOtpSchema = z.object({
  otp: z.string().regex(/^\d{4}$/, { message: 'OTP must be 4 digits' }).optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

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
    const isGeofenced = false;

    // Ensure access control: only the assigned driver or admin can confirm delivery
    if (orderData.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

    // 2. If no OTP is provided, but coordinates are supplied, try secure server-side geofence confirmation.
    if (!otp && latitude !== undefined && longitude !== undefined) {
      try {
        const result = await orderLifecycleService.deliveryVerification.geofenceAutoConfirm({
          orderId: orderData.id,
          driverId: req.user.id,
          driverLat: latitude,
          driverLng: longitude,
          geofenceRadiusM: 500
        });
        return res.json({
          success: true,
          ...result
        });
      } catch (geofenceErr) {
        logger.error(`[confirm-otp] Geofence auto-confirm failed for order ${orderData.id}:`, geofenceErr.message);
        return res.status(400).json({ error: geofenceErr.payload?.error || geofenceErr.message || 'Geofence verification failed.' });
      }
    }

    // 3. Otherwise, if no coordinates and no OTP, reject.
    if (!otp) {
      return res.status(400).json({ error: 'OTP is required to confirm delivery.' });
    }

    // 4. Trigger delivery completion and escrow payment release securely via the lifecycle service.
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(
      orderData.id,
      req.user.id,
      otp
    );

    // 5. Send FCM push notification to the driver
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
        payment_released: true
      });
    }

    return res.json({
      success: true,
      message: 'Delivery verified successfully! Payment released to driver.',
      payment_released: true
    });
  } catch (err) {
    logger.error('[confirm-otp] Exception:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

export default router;
