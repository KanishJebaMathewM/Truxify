import express from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLock, releaseLock, LockAcquisitionError } from '../lib/redisLock.js';
import { auditLog } from '../middleware/auditLog.js';
import logger from '../middleware/logger.js';
import { createStore } from '../middleware/rateLimiter.js';
import { orderRepository, orderValidationService } from '../core/container.js';
import { supabase, createUserClient } from '../config/db.js';
import {
  recordDepositTx,
  getEscrowBookingId,
  paisaToMaticWei,
  isEscrowEnabled,
  escrowLockPayment,
  resolveExpectedDepositAmount,
  submitEscrowRefund,
} from '../services/escrow.js';
import { sendPushNotification } from '../services/notificationService.js';
import { invalidateDriverOrderCache } from '../sockets/tracker.js';
import upiPaymentService from '../services/payment/UpiPaymentService.js';

const router = express.Router();

// ─── Lock TTL constants ───────────────────────────────────────────────────────

/** How long to hold the payment lock while verifying on-chain and updating DB. */
const PAYMENT_LOCK_TTL_MS = 30_000; // 30 seconds

// ─── Rate Limiters ────────────────────────────────────────────────────────────
// Redis-backed stores so multi-replica deploys share one budget (MemoryStore
// would allow N× the limit across N API pods).

const lockLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  message: { error: 'Too many payment requests. Please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('rl:payment-lock:'),
});

const statusLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  store: createStore('rl:payment-status:'),
});

// ─── Validation Schemas ───────────────────────────────────────────────────────

const lockPaymentSchema = z.object({
  bookingId: z.string(), // Order UUID or display ID
  upiReference: z.string(),
  amount: z.number().positive(), // Paid amount in paisa
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
        logger.error({ event: 'PAYMENT_UPI_NOT_CONFIGURED', orderId: order_id }, '[payments] PLATFORM_UPI_ID is not configured; cannot generate UPI intent');
        return res.status(503).json({ error: 'UPI payments are not configured on the server.' });
      }
      const orderRef = order.order_display_id;

    const orderData = order.data;

    // Ensure only the customer who created it or admin can lock it
    if (orderData.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    if (orderData.escrow_status === 'funded') {
      return res.status(200).json({
        success: true,
        message: 'Payment is already locked in escrow.',
        txHash: orderData.deposit_tx_hash,
        bookingId: orderData.escrow_booking_id
      });
    } catch (err) {
      logger.error(
        { event: 'PAYMENT_UPI_INTENT_ERROR', requestId: req.requestId || req.id, error: err && err.message },
        '[payments] upi-intent error',
      );
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

      const pending = order.pending_bid_acceptance;
      if (pending) {
        const { error: acceptErr } = await orderRepository.executeRpc('accept_bid_tx', {
          p_bid_id: pending.bid_id,
          p_order_id: order.id,
          p_load_id: pending.load_id,
          p_driver_id: pending.driver_id,
          p_truck_id: pending.truck_id,
          p_driver_name: pending.driver_name,
          p_driver_rating: pending.driver_rating,
          p_truck_number: pending.truck_number,
          p_bid_amount: pending.bid_amount,
          p_order_display_id: pending.order_display_id,
          p_expected_version: pending.version,
          p_escrow_booking_id: bookingId,
        }, req.token ? createUserClient(req.token) : undefined);

        if (acceptErr) {
          logger.error('[payments] accept_bid_tx failed after lock:', acceptErr.message);
          let refundResult;
          try {
            refundResult = await submitEscrowRefund(order.order_display_id);
          } catch (refundErr) {
            logger.error('[payments] Escrow refund also failed:', refundErr.message);
            refundResult = { error: refundErr.message };
          }
          let refundConfirmed = !!(refundResult && !refundResult.error && refundResult.txHash);
          if (refundConfirmed && typeof refundResult.waitForConfirmation === 'function') {
            try {
              await refundResult.waitForConfirmation();
            } catch (confirmErr) {
              logger.error('[payments] Escrow refund confirmation failed:', confirmErr.message);
              refundResult = { error: confirmErr.message, txHash: refundResult.txHash };
              refundConfirmed = false;
            }
          } else if (refundConfirmed && typeof refundResult.waitForConfirmation !== 'function') {
            refundConfirmed = false;
            refundResult = {
              error: refundResult.error || 'escrow refund confirmation is unavailable',
              txHash: refundResult.txHash,
            };
          }

          if (!refundConfirmed) {
            const refundError = refundResult?.error || 'escrow refund was not submitted';
            await orderRepository.updateOrder(order.id, {
              escrow_status: 'funding',
              escrow_funding_error: `escrow refund pending: ${refundError}`,
            }).catch((stateErr) => {
              logger.error('[payments] Failed to mark escrow refund pending:', stateErr.message);
            });
            return res.status(503).json({
              error: 'Payment locked but the driver assignment could not be finalized. The escrow refund is pending and will be completed automatically. Please try again shortly.',
              details: `${acceptErr.message}; escrow refund: ${refundError}`,
            });
          }

          await orderRepository.revertEscrowStatus(order.id).catch((revertErr) => {
            logger.error('[payments] Failed to revert escrow status:', revertErr.message);
          });
          return res.status(409).json({
            error: 'Payment locked but the driver assignment could not be finalized. The escrow deposit has been refunded. Please try again.',
            details: acceptErr.message,
          });
        }

        // Driver assignment confirmed — drop any stale cached mapping so the
        // tracker resolves the newly assigned driver on the next ping
        // (issue #10676).
        await invalidateDriverOrderCache(pending.driver_id);

        sendPushNotification(
          pending.driver_id,
          'Bid Accepted!',
          `Your bid for order ${pending.order_display_id} has been accepted. You are now assigned to this load.`,
          'order_update',
          { orderId: order.id, orderDisplayId: pending.order_display_id }
        ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err.message}`));

        sendPushNotification(
          pending.driver_id,
          '💰 Payment Locked',
          `Customer payment for order ${order.order_display_id} is now locked in escrow. Proceed with delivery.`,
          'payment',
          { order_display_id: order.order_display_id, tx_hash }
        ).catch(err => logger.warn('[payments] Driver FCM push failed:', err.message));
      } else if (order.driver_id) {
        await invalidateDriverOrderCache(order.driver_id);
        sendPushNotification(
          order.driver_id,
          '💰 Payment Locked',
          `Customer payment for order ${order.order_display_id} is now locked in escrow. Proceed with delivery.`,
          'payment',
          { order_display_id: order.order_display_id, tx_hash }
        ).catch(err => logger.warn('[payments] Driver FCM push failed:', err.message));
      }

    const { data: customerProfile } = await orderRepository.findCustomerWallet(req.user.id);
    const customerWallet = customerProfile?.polygon_wallet_address ?? null;

    if (!driverWallet || !customerWallet) {
      return res.status(422).json({
        error: 'Wallet disconnected: customer or driver does not have a registered Polygon address.'
      });
    }

    // Convert the paid amount to Matic Wei
    const amountWei = paisaToMaticWei(amount);

    // Call the smart contract lockPayment on-chain
    const result = await lockPayment(
      orderData.order_display_id,
      customerWallet,
      driverWallet,
      amountWei
    );

    if (result.error) {
      logger.error(`[lock-payment] Blockchain lock failed for order ${orderData.order_display_id}: ${result.error}`);
      return res.status(502).json({
        error: 'Failed to lock payment in blockchain escrow.',
        details: result.error
      });
    }

    // Update order status in Postgres
    const { error: updateErr } = await orderRepository.updateOrder(orderData.id, {
      escrow_status: 'funded',
      deposit_tx_hash: result.txHash,
      escrow_deposited_at: new Date().toISOString(),
      escrow_booking_id: result.bookingId,
      upi_reference: upiReference, // Save UPI transaction reference
    });

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
      logger.error(
        { event: 'PAYMENT_STATUS_ERROR', requestId: req.requestId || req.id, error: err && err.message },
        '[payments] status error',
      );
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    return res.json({
      success: true,
      message: 'Payment successfully locked in blockchain escrow.',
      txHash: result.txHash,
      bookingId: result.bookingId
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[payments/lock] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
