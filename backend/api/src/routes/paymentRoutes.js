/**
 * Payment Routes — UPI → Escrow → Release
 *
 * POST /api/payments/lock
 *   Customer calls this after submitting the on-chain createBooking() tx
 *   via their wallet. The backend verifies the tx on Polygon, then marks
 *   the order escrow_status as 'funded'.
 *
 * GET /api/payments/:orderId/status
 *   Lightweight polling endpoint for the Flutter app to check escrow state.
 *
 * POST /api/payments/upi-intent
 *   Returns the UPI payment intent details (amount, UPI ID, order reference)
 *   needed to construct the UPI deep-link in the Flutter app.
 *
 * POST /api/payments/charge-and-lock
 *   Initiates an on-chain lockPayment() call and marks escrow as funded.
 */

import express from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLock, releaseLock, LockAcquisitionError } from '../lib/redisLock.js';
import { auditLog } from '../middleware/auditLog.js';
import logger from '../middleware/logger.js';
import { orderRepository, orderValidationService } from '../core/container.js';
import { supabase } from '../config/db.js';
import {
  recordDepositTx,
  getEscrowBookingId,
  paisaToMaticWei,
  isEscrowEnabled,
  escrowLockPayment,
  resolveExpectedDepositAmount,
} from '../services/escrow.js';
import { sendPushNotification } from '../services/notificationService.js';
import upiPaymentService from '../services/payment/UpiPaymentService.js';

const router = express.Router();

// ─── Lock TTL constants ───────────────────────────────────────────────────────

/** How long to hold the payment lock while verifying on-chain and updating DB. */
const PAYMENT_LOCK_TTL_MS = 30_000; // 30 seconds

// ─── Rate Limiters ────────────────────────────────────────────────────────────

const lockLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many payment requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// ─── Validation Schemas ───────────────────────────────────────────────────────

const lockPaymentSchema = z.object({
  order_id: z.string().min(1, 'order_id is required'),
  tx_hash: z
    .string()
    .regex(/^0x[0-9a-fA-F]{64}$/, 'tx_hash must be a valid 0x-prefixed 32-byte hex transaction hash'),
  wallet_address: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, 'wallet_address must be a valid Ethereum address')
    .optional(),
}).strict();

const upiIntentSchema = z.object({
  order_id: z.string().min(1, 'order_id is required'),
}).strict();

const orderIdParamSchema = z.object({
  orderId: z.string().min(1),
});

const chargeAndLockSchema = z.object({
  order_id: z.string().min(1, 'order_id is required'),
  customer_upi_id: z.string().min(1, 'customer_upi_id is required'),
}).strict();

// ─── POST /api/payments/upi-intent ───────────────────────────────────────────
/**
 * Returns UPI deep-link parameters for the Flutter app.
 * The Flutter app uses these to open the user's UPI app via url_launcher.
 *
 * Response: { upi_id, amount_inr, amount_paisa, order_ref, deep_link }
 */
router.post(
  '/upi-intent',
  authenticate,
  lockLimiter,
  requireIdempotency(3600),
  validateBody(upiIntentSchema),
  async (req, res) => {
    try {
      const { order_id } = req.body;

      let order;
      try {
        order = await orderValidationService.findOrderByIdOrDisplayId(
          order_id,
          'id, order_display_id, customer_id, total_amount, escrow_status, status'
        );
      } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch order.' });
      }

      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (order.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      // Only allow intent if the escrow hasn't been funded yet
      const blockingStatuses = ['funded', 'released', 'refunded'];
      if (blockingStatuses.includes(order.escrow_status)) {
        return res.status(409).json({
          error: `Payment already in status: ${order.escrow_status}`,
          escrow_status: order.escrow_status,
        });
      }

      // Total amount is stored in paisa; convert to INR for display
      const amountPaisa = order.total_amount || 0;
      const amountInr = (amountPaisa / 100).toFixed(2);

      const platformUpiId = process.env.PLATFORM_UPI_ID?.trim();
      if (!platformUpiId) {
        logger.error('[payments] PLATFORM_UPI_ID is not configured; cannot generate UPI intent');
        return res.status(503).json({ error: 'UPI payments are not configured on the server.' });
      }
      const orderRef = order.order_display_id;

      // Standard UPI deep-link format (works with GPay, PhonePe, Paytm, BHIM)
      const deepLink =
        `upi://pay?pa=${encodeURIComponent(platformUpiId)}` +
        `&pn=Truxify` +
        `&am=${amountInr}` +
        `&cu=INR` +
        `&tn=${encodeURIComponent(`Freight payment for ${orderRef}`)}` +
        `&tr=${encodeURIComponent(orderRef)}`;

      logger.info(`[payments] UPI intent generated for order ${orderRef}`);

      return res.json({
        upi_id: platformUpiId,
        amount_inr: amountInr,
        amount_paisa: amountPaisa,
        order_ref: orderRef,
        deep_link: deepLink,
        escrow_enabled: isEscrowEnabled(),
      });
    } catch (err) {
      logger.error('[payments] upi-intent error:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ─── POST /api/payments/lock ──────────────────────────────────────────────────
/**
 * Called by the customer Flutter app AFTER the customer's wallet has submitted
 * the createBooking() transaction on-chain. The backend:
 *   1. Acquires a Redis lock (fail-closed — returns 503 if Redis is down)
 *   2. Finds the order and verifies ownership
 *   3. Calls recordDepositTx() to verify tx on Polygon
 *   4. Updates escrow_status → 'funded'
 *   5. Sends FCM push to the assigned driver (if any)
 *   6. Releases the lock in `finally` using the owner token
 *
 * Fix summary vs. previous version:
 *   - acquireLock now receives the correct TTL in ms (30_000, not 30)
 *   - lockValue (the owner UUID) is stored and passed to releaseLock —
 *     previously releaseLock was called with one argument so the Lua owner
 *     check always failed and the lock was never released until TTL expiry
 *   - LockAcquisitionError (Redis unavailable) returns 503, not 409
 *   - 409 is reserved for "lock is held — payment in progress"
 */
router.post(
  '/lock',
  authenticate,
  lockLimiter,
  requireIdempotency(3600),
  validateBody(lockPaymentSchema),
  auditLog({ action: 'payment:lock', resourceType: 'escrow' }),
  async (req, res) => {
    const { order_id, tx_hash } = req.body;
    const lockKey = `payment_lock:${order_id}`;

    // lockValue holds the owner UUID returned by acquireLock.
    // It is passed to releaseLock in `finally` to ensure only we can delete the lock.
    let lockValue = null;

    try {
      // acquireLock throws LockAcquisitionError when Redis is unavailable.
      // It returns null when the lock is already held by another request.
      lockValue = await acquireLock(lockKey, PAYMENT_LOCK_TTL_MS);

      if (lockValue === null) {
        return res.status(409).json({
          error: 'Payment is already being processed for this order. Please wait.',
        });
      }

      // 1. Fetch order
      let order;
      try {
        order = await orderValidationService.findOrderByIdOrDisplayId(
          order_id,
          'id, order_display_id, customer_id, driver_id, total_amount, escrow_status, escrow_booking_id, wallet_address, escrow_driver_wallet, escrow_amount_wei, pending_bid_acceptance'
        );
      } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch order.' });
      }

      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      if (order.customer_id !== req.user.id) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      // 2. Idempotency — already funded
      if (order.escrow_status === 'funded') {
        logger.info(`[payments] Order ${order.order_display_id} already funded — idempotent response`);
        return res.json({
          message: 'Payment already locked in escrow.',
          escrow_status: 'funded',
          order_display_id: order.order_display_id,
        });
      }

      const blockingStatuses = ['released', 'refunded'];
      if (blockingStatuses.includes(order.escrow_status)) {
        return res.status(409).json({
          error: `Cannot lock payment — escrow is already in status: ${order.escrow_status}`,
        });
      }

      // 3. The deposit may only be locked while the order is in 'funding'
      //    state. A lock must never be accepted for an order that was not
      //    staged for escrow funding.
      if (order.escrow_status !== 'funding') {
        return res.status(409).json({
          error: `Cannot lock payment — escrow must be in 'funding' state, current status: ${order.escrow_status}`,
        });
      }

      // 4. Derive the on-chain booking ID
      const bookingId = order.escrow_booking_id || getEscrowBookingId(order.order_display_id);

      // 5. Verify the deposit transaction on-chain against the order's escrow
      //    booking: the sender must be the authenticated customer's profile
      //    wallet (never a client-supplied wallet_address), the booking must
      //    be created for the assigned driver, and funded with at least the
      //    expected escrow amount. The client-supplied tx_hash is never
      //    trusted without on-chain verification (no dev trust path).
      const { data: customerProfile } = await orderRepository.findCustomerWallet(req.user.id);
      const senderAddress = customerProfile?.polygon_wallet_address ?? null;
      if (!senderAddress) {
        return res.status(422).json({
          error: 'No Polygon wallet is registered on your profile. Add a wallet before locking escrow payment.',
          code: 'WALLET_REQUIRED',
        });
      }

      // Resolve the authoritative expected deposit amount (cross-checked
      // against the server-written bid context). If it cannot be resolved the
      // deposit is rejected — the amount on-chain must always equal the amount
      // the app recorded for this order.
      const resolvedAmount = resolveExpectedDepositAmount(order);
      if (resolvedAmount.error) {
        return res.status(422).json({ error: resolvedAmount.error, code: resolvedAmount.code });
      }
      const expectedAmountWei = resolvedAmount.expectedAmountWei;

      const result = await recordDepositTx(
        bookingId,
        tx_hash,
        senderAddress,
        order.escrow_driver_wallet ?? null,
        expectedAmountWei
      );

      if (result.error) {
        logger.warn(`[payments] recordDepositTx failed for ${order.order_display_id}: ${result.error}`);
        return res.status(422).json({
          error: `Transaction verification failed: ${result.error}`,
          code: result.code,
          hint: 'Ensure the transaction is confirmed on Polygon and the wallet address matches your profile.',
        });
      }

      // 5. Update escrow_status → funded
      const { error: updateErr } = await orderRepository.updateOrderWithFilter(
        order.id,
        {
          escrow_status: 'funded',
          escrow_booking_id: bookingId,
          escrow_tx_hash: tx_hash,
          updated_at: new Date().toISOString(),
        },
        [{ op: 'neq', column: 'escrow_status', value: 'funded' }]
      );

      if (updateErr) {
        logger.error('[payments] Failed to update escrow_status:', updateErr.message);
        return res.status(500).json({
          error: 'Payment verified but database update failed. Please contact support.',
        });
      }

      // 7. Notify assigned driver that payment is now locked
      if (order.driver_id) {
        sendPushNotification(
          order.driver_id,
          '💰 Payment Locked',
          `Customer payment for order ${order.order_display_id} is now locked in escrow. Proceed with delivery.`,
          'payment',
          { order_display_id: order.order_display_id, tx_hash }
        ).catch(err => logger.warn('[payments] Driver FCM push failed:', err.message));
      }

      logger.info(`[payments] Payment locked for order ${order.order_display_id}`);

      return res.status(201).json({
        message: 'Payment successfully locked in escrow. It will be released to the driver upon delivery confirmation.',
        escrow_status: 'funded',
        order_display_id: order.order_display_id,
        booking_id: bookingId,
        tx_hash,
      });

    } catch (err) {
      if (err instanceof LockAcquisitionError) {
        // Redis is down — do NOT proceed with the payment mutation.
        logger.error('[payments] Redis unavailable — refusing payment lock:', err.message);
        return res.status(503).json({
          error: 'Payment service temporarily unavailable. Please retry in a moment.',
        });
      }
      logger.error('[payments] lock error:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });

    } finally {
      if (lockValue) {
        try {
          await releaseLock(lockKey, lockValue);
        } catch (releaseErr) {
          logger.error(
            { err: releaseErr, lockKey },
            'Failed to release payment lock'
          );
        }
      }
    }
  }
);

// ─── GET /api/payments/:orderId/status ───────────────────────────────────────
/**
 * Returns current escrow status for an order.
 * Used by Flutter to poll after submitting the UPI payment.
 */
router.get(
  '/:orderId/status',
  authenticate,
  statusLimiter,
  validateParams(orderIdParamSchema),
  async (req, res) => {
    try {
      let order;
      try {
        order = await orderValidationService.findOrderByIdOrDisplayId(
          req.params.orderId,
          'id, order_display_id, customer_id, driver_id, escrow_status, escrow_booking_id, escrow_deposited_at, escrow_released_at, total_amount, status'
        );
      } catch (err) {
        return res.status(500).json({ error: 'Failed to fetch order.' });
      }

      if (!order) {
        return res.status(404).json({ error: 'Order not found.' });
      }

      // Both the customer and assigned driver may poll this
      const isParticipant =
        order.customer_id === req.user.id || order.driver_id === req.user.id;

      if (!isParticipant) {
        return res.status(403).json({ error: 'Access denied.' });
      }

      return res.json({
        order_display_id: order.order_display_id,
        escrow_status: order.escrow_status,
        escrow_booking_id: order.escrow_booking_id,
        escrow_deposited_at: order.escrow_deposited_at,
        escrow_released_at: order.escrow_released_at,
        total_amount_paisa: order.total_amount,
        total_amount_inr: order.total_amount
          ? (order.total_amount / 100).toFixed(2)
          : null,
        order_status: order.status,
        escrow_enabled: isEscrowEnabled(),
      });
    } catch (err) {
      logger.error('[payments] status error:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ─── POST /api/payments/charge-and-lock ──────────────────────────────────────
/**
 * Initiates an on-chain lockPayment() call from the backend relayer and marks
 * the escrow as funded.
 *
 * Fix vs. previous version:
 *   - Added Redis lock guard (was entirely missing, allowing concurrent calls
 *     to double-charge and double-lock the same order)
 *   - LockAcquisitionError returns 503; null lock returns 409
 *   - lockValue is passed correctly to releaseLock in finally
 */
router.post(
  '/charge-and-lock',
  authenticate,
  lockLimiter,
  validateBody(chargeAndLockSchema),
  async (req, res) => {
    return res.status(410).json({
      error: 'This endpoint has been disabled. Use POST /api/payments/upi-intent to generate a UPI deep-link, then POST /api/payments/lock with the on-chain tx_hash after your wallet confirms the deposit.',
    });
  }
);

export default router;