import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { userLimiter } from '../middleware/rateLimiter.js';
import { validateBody } from '../middleware/validate.js';
import { orderRepository, orderLifecycleService, logger } from '../core/container.js';
import { sendFcmNotification } from '../services/notificationService.js';
import crypto from 'crypto';

const router = express.Router();

const confirmOtpSchema = z.object({
  otp: z.string().regex(/^\d{4}$/, { message: 'OTP must be 4 digits' }).optional(),
  // Accepted for client compatibility but deliberately not authoritative:
  // self-reported coordinates must never satisfy the escrow release gate.
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

router.post('/:id/confirm-otp', authenticate, userLimiter, validateBody(confirmOtpSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { otp } = req.body;

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

    // 2. The customer-entered OTP is the ONLY signal that releases escrow.
    //
    // A geofence used to be accepted here as a substitute for the OTP, computed
    // from latitude/longitude in this request body. That made the bypass
    // self-asserted: the assigned driver could echo the order's own drop
    // coordinates back and get distance 0, and the route then stored a constant
    // 'GEOF' string as a valid OTP and released payment. This contradicts the
    // documented model in DeliveryVerificationService.geofenceAutoConfirm, which
    // uses server-ingested telemetry for presence and states that self-reported
    // GPS alone must never satisfy the release gate.
    //
    // Presence telemetry is still enforced where it belongs, by
    // assertDriverAtDropoff(), which records a flag without releasing payment.
    if (!otp) {
      return res.status(400).json({
        error: 'OTP is required to confirm delivery. The customer must provide the delivery OTP.'
      });
    }

    // 3. Trigger delivery completion and escrow payment release
    // This calls verifyDelivery under the hood which releases smart contract payments
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(
      orderData.id,
      req.user.id,
      otp
    );

    // 4. Send FCM push notification to the driver: "Payment Released ✓ ₹XXXX credited"
    const displayAmount = orderData.total_amount ? (orderData.total_amount / 100).toFixed(2) : '0.00';
    await sendFcmNotification(req.user.id, {
      title: 'Payment Released',
      body: `✓ ₹${displayAmount} credited`
    }).catch(err => {
      logger.warn(`[confirm-otp] Notification delivery failed: ${err.message}`);
    });

    // isGeofenced is retained as a constant false so older clients keep taking
    // the OTP branch. Auto-confirm by geofence no longer exists on this route.
    if (escrowUpdateFailed) {
      return res.status(202).json({
        message: 'Delivery verified successfully. Escrow payout requires reconciliation.',
        escrow_status: 'released',
        payment_released: true,
        isGeofenced: false
      });
    }

    return res.json({
      success: true,
      message: 'Delivery verified successfully! Payment released to driver.',
      payment_released: true,
      isGeofenced: false
    });
  } catch (err) {
    logger.error('[confirm-otp] Exception:', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Internal Server Error' });
  }
});

export default router;
