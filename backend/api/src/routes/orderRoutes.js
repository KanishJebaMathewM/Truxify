const express = require('express');
const router = express.Router();
const orderRepository = require('../repositories/orderRepository');
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/roles');
const { userLimiter, bidLimiter } = require('../middleware/rateLimiter');
const { validateParams, validateBody } = require('../middleware/validation');
const { paramIdSchema, submitBidSchema, confirmDepositSchema } = require('../validators/orderValidators');
const { DomainError } = require('../errors/DomainError');
const logger = require('../utils/logger');
/**
 * @openapi
 * components:
 *   schemas:
 *     CreateOrderRequest:
 *       type: object
 *       properties:
 *         pickup_address:
 *           type: string
 *         drop_address:
 *           type: string
 *         pickup_lat:
 *           type: number
 *         pickup_lng:
 *           type: number
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *         weight_tonnes:
 *           type: number
 *         goods_type:
 *           type: string
 *         is_fragile:
 *           type: boolean
 *         is_stackable:
 *           type: boolean
 *     OrderListResponse:
 *       type: object
 *       properties:
 *         page:
 *           type: integer
 *         limit:
 *           type: integer
 *         total:
 *           type: integer
 *         totalPages:
 *           type: integer
 *         orders:
 *           type: array
 *           items:
 *             type: object
 *     SubmitBidRequest:
 *       type: object
 *       required:
 *         - amount
 *       properties:
 *         amount:
 *           type: number
 *           description: Bid amount in paisa
 *     SubmitRatingRequest:
 *       type: object
 *       required:
 *         - rating
 *       properties:
 *         rating:
 *           type: integer
 *           minimum: 1
 *           maximum: 5
 *         review:
 *           type: string
 *     AcceptBidResponse:
 *       type: object
 *       properties:
 *         message:
 *           type: string
 *         order:
 *           type: object
 *     UpdateMilestoneRequest:
 *       type: object
 *       required:
 *         - milestone
 *       properties:
 *         milestone:
 *           type: string
 *     VerifyDeliveryResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *         message:
 *           type: string
 *     ChangeDropRequest:
 *       type: object
 *       required:
 *         - drop_lat
 *         - drop_lng
 *       properties:
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *         drop_address:
 *           type: string
 *     CancelOrderRequest:
 *       type: object
 *       required:
 *         - reason
 *       properties:
 *         reason:
 *           type: string
 *     PredictDemandRequest:
 *       type: object
 *       properties:
 *         pickup_lat:
 *           type: number
 *         pickup_lng:
 *           type: number
 *         drop_lat:
 *           type: number
 *         drop_lng:
 *           type: number
 *     DriverLocationResponse:
 *       type: object
 *       properties:
 *         driver_id:
 *           type: string
 *         lat:
 *           type: number
 *         lng:
 *           type: number
 *         updated_at:
 *           type: string
 *     OrderRouteResponse:
 *       type: object
 *       properties:
 *         route:
 *           type: array
 *           items:
 *             type: object
 *             properties:
 *               lat:
 *                 type: number
 *               lng:
 *                 type: number
 *         distance_km:
 *           type: number
 *         duration_minutes:
 *           type: number
 */

import express from 'express';
import multer from 'multer';
import crypto from 'crypto';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import {
  bidLimiter,
  userLimiter,
  safeIpKeyGenerator,
  userKeyGenerator,
  podUploadLimiter,
  createStore,
  verifyDeliveryLimiter,
  resendOtpLimiter,
  changeDropLimiter,
  predictDemandLimiter,
  telemetryLimiter,
} from '../middleware/rateLimiter.js';
import { mongoDb, supabase, redisClient, createUserClient, supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateDocumentBuffer } from '../lib/documentValidation.js';
import { scanDocument } from '../lib/malwareScanner.js';
import { validateBody, validateParams, validateQuery } from '../middleware/validate.js';
import {
  createOrderSchema, submitBidSchema, submitRatingSchema, paramIdSchema, acceptBidParamsSchema,
  updateMilestoneSchema, verifyDeliverySchema, predictDemandSchema, changeDropSchema, cancelOrderSchema,
} from '../validation/requestSchemas.js';
import { awardReputationPoints } from '../services/reputation.js';
import { expireDeliveryOtps, sendPushNotification } from '../services/notificationService.js';
import { DomainError } from '../services/order/domainError.js';
import { predictDemand, predictPrice, matchEnRouteLoads } from '../services/ml.js';
import { getEscrowBookingId, resolveExpectedDepositAmount, paisaToMaticWei, submitEscrowRefund } from '../services/escrow.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLockOrFallback } from '../lib/lockFallback.js';
import { acquireLock, releaseLock, LockAcquisitionError } from '../lib/redisLock.js';
import logger from '../middleware/logger.js';
import { invalidateBookingCaches } from '../utils/cacheInvalidation.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  orderRepository,
  orderValidationService,
  orderTimelineService,
  orderMilestoneService,
  orderLifecycleService,
  deliveryVerificationService,
  buildDepositTx,
  recordDepositTx,
  confirmEscrowRefund,
} from '../core/container.js';
import {
  createOrder,
  getActiveOrders,
  getLoadOffers,
  getOrderHistory,
  getOrderDetails,
  verifyDeliveryController,
  resendOtp,
  changeDrop,
  cancelOrder,
  predictRideDemand,
} from '../controllers/orderController.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';
import {
  validatePodFile,
  generatePodStoragePath,
  uploadPodFile,
  createPodSignedUrl
} from '../lib/storage/podStorage.js';
import { escrowLockManager } from '../lib/escrow/escrowLockManager.js';

const router = express.Router();
const MAX_GEOFENCE_RADIUS_M = 500;

const milestoneStore = createStore('rl:milestone:');
const milestoneLimiter = rateLimit({
  windowMs: 60 * 1000, 
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyGenerator: (req) => req.user?.id || 'unknown',
  ...(milestoneStore && typeof milestoneStore.init === 'function' ? { store: milestoneStore } : {}),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many milestone updates. Please slow down.' },
});


// 1. CREATE ORDER (CUSTOMER)
router.post('/', authenticate, userLimiter, requirePolicy('order:create'), validateBody(createOrderSchema), createOrder);

// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), getActiveOrders);

// 3. FETCH LOAD OFFERS (MARKETPLACE)
router.get('/load-offers', authenticate, userLimiter, getLoadOffers);

// ============================================================================
// 17. CONFIRM ORDER DEPOSIT / ESCROW LOCK — POST /api/orders/:id/confirm-deposit
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/confirm-deposit:
 *   post:
 *     tags: [Orders]
 *     summary: Confirm deposit or escrow lock for an order
 *     description: Verifies and locks the deposit/escrow funds required to proceed with an order.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ConfirmDepositRequest'
 *     responses:
 *       200:
 *         description: Deposit confirmed and escrow locked successfully
 *       400:
 *         description: Invalid transaction reference or insufficient funds
 *       404:
 *         description: Order not found
 */
router.post('/:id/confirm-deposit', authenticate, userLimiter, validateParams(paramIdSchema), validateBody(confirmDepositSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;
    const { paymentIntentId, amount } = req.body;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access to this order' });
    }

    const depositResult = await orderRepository.lockEscrowDeposit({
      orderId,
      paymentIntentId,
      amount,
    });

    if (depositResult.error) {
      logger.error('[confirm-deposit] Escrow lock failed:', depositResult.error.message);
      return res.status(400).json({ error: depositResult.error.message || 'Failed to confirm deposit' });
    }

    return res.status(200).json({
      message: 'Deposit confirmed and escrow locked successfully',
      order: depositResult.data,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[confirm-deposit] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid for an order load
 *     description: Allows an authenticated driver to submit a bid amount (in paisa) for an available order.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SubmitBidRequest'
 *     responses:
 *       201:
 *         description: Bid submitted successfully
 *       400:
 *         description: Invalid input or missing required fields
 *       404:
 *         description: Order not found
 */
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const driverId = req.user.id;
    const { amount } = req.body;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    const bidData = {
      order_id: orderId,
      driver_id: driverId,
      amount,
      status: 'pending',
      created_at: new Date().toISOString(),
    };
    // acquireLock throws LockAcquisitionError when Redis is unavailable and
    // returns null when the lock is already held by another request.
    lockValue = await acquireLock(lockKey, 120000);
    if (!lockValue) {
      return res.status(409).json({ error: 'Another deposit confirmation is in progress for this order. Please try again.' });
    }

    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, status, order_display_id, customer_id, escrow_booking_id, escrow_status, escrow_amount_wei, escrow_driver_wallet, pending_bid_acceptance, total_amount, version');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);
    orderValidationService.assertEscrowState(order, ['funding'], 'Order is not in funding state');
    if (order.status === 'cancelled') return res.status(409).json({ error: 'Order is already cancelled. Cannot confirm deposit.' });

    const { data: customerProfile } = await orderRepository.findCustomerWallet(req.user.id);
    const customerWallet = customerProfile?.polygon_wallet_address ?? null;
    const bookingId = order.escrow_booking_id || (order.order_display_id ? getEscrowBookingId(order.order_display_id) : orderId);

    // Two-phase acceptance (#5724): once the deposit is verified on-chain we
    // finalize the driver assignment via accept_bid_tx. If that cannot be
    // completed the deposit is refunded and the order stays pending.
    const finalizeAcceptance = async () => {
      const pending = order.pending_bid_acceptance;
      if (!pending) return;
      const { error: acceptErr } = await orderRepository.executeRpc('accept_bid_tx', {
        p_bid_id: pending.bid_id,
        p_order_id: orderId,
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
      }, req.token ? createUserClient(req.token) ?? supabaseAdmin : supabaseAdmin);
      if (acceptErr) {
        logger.error('[confirm-deposit] accept_bid_tx failed:', acceptErr.message);
        // The refund is authoritative: only claim the deposit was refunded once
        // the on-chain refund was actually submitted. submitEscrowRefund resolves to
        // { txHash, bookingId, waitForConfirmation } on success or
        // { txHash: null, bookingId, error } when the submit fails.
        let refundResult;
        try {
          refundResult = await submitEscrowRefund(order.order_display_id);
        } catch (refundErr) {
          logger.error('[confirm-deposit] Escrow refund also failed:', refundErr.message);
          refundResult = { error: refundErr.message };
        }
        let refundConfirmed = !!(refundResult && !refundResult.error && refundResult.txHash);
        if (refundConfirmed && typeof refundResult.waitForConfirmation === 'function') {
          try {
            await refundResult.waitForConfirmation();
          } catch (confirmErr) {
            logger.error('[confirm-deposit] Escrow refund confirmation failed:', confirmErr.message);
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
          // The deposit is still locked on-chain. Keep escrow_booking_id and
          // pending_bid_acceptance intact and return the order to the 'funding'
          // state so escrowFundingReconciliation reclaims the deposit; report a
          // retryable error instead of a false "refunded" success.
          const refundError = refundResult?.error || 'escrow refund was not submitted';
          await orderRepository.updateOrder(orderId, {
            escrow_status: 'funding',
            escrow_funding_error: `escrow refund pending: ${refundError}`,
          }).catch((stateErr) => {
            logger.error('[confirm-deposit] Failed to mark escrow refund pending:', stateErr.message);
          });
          throw new DomainError(503, {
            error: 'Deposit confirmed but the driver assignment could not be finalized. The escrow refund is pending and will be completed automatically. Please try again shortly.',
            details: `${acceptErr.message}; escrow refund: ${refundError}`,
          });
        }

        // Refund confirmed on-chain — safe to release the escrow booking reference.
        // Also clear pending_bid_acceptance so the order can accept a new bid.
        await orderRepository.updateOrder(orderId, {
          pending_bid_acceptance: null,
        }).catch((clearErr) => {
          logger.error('[confirm-deposit] Failed to clear pending_bid_acceptance:', clearErr.message);
        });
        await orderRepository.revertEscrowStatus(orderId).catch((revertErr) => {
          logger.error('[confirm-deposit] Failed to revert escrow status:', revertErr.message);
        });
        throw new DomainError(409, {
          error: 'Deposit confirmed but the driver assignment could not be finalized. The escrow deposit has been refunded. Please try again.',
          details: acceptErr.message,
        });
      }
      sendPushNotification(
        pending.driver_id,
        'Bid Accepted!',
        `Your bid for order ${pending.order_display_id} has been accepted. You are now assigned to this load.`,
        'order_update',
        { orderId, orderDisplayId: pending.order_display_id }
      ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err?.message}`));
    };

    // Resolve the authoritative expected deposit amount for this order and
    // cross-check it against the server-written bid context. This must happen
    // BEFORE any client-supplied value is trusted: the on-chain deposit is
    // only accepted if it matches the amount the app actually recorded.
    const resolvedAmount = resolveExpectedDepositAmount(order);
    if (resolvedAmount.error) {
      return res.status(422).json({ error: resolvedAmount.error, code: resolvedAmount.code });
    }
    const expectedAmountWei = resolvedAmount.expectedAmountWei;

    const result = await recordDepositTx(
      bookingId,
      txHash,
      customerWallet,
      order.escrow_driver_wallet ?? null,
      expectedAmountWei
    );

    if (result.error) {
      return res.status(422).json({ error: result.error, code: result.code });
    }

    const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(
      orderId,
      {
        escrow_status: 'funded',
        escrow_funding_error: null,
        version: (order.version || 0) + 1,
        updated_at: new Date().toISOString(),
      },
      [
        { op: 'eq', column: 'escrow_status', value: 'funding' },
        { op: 'eq', column: 'version', value: order.version },
      ],
      'id'
    );

    if (result.alreadyFunded) {
      if (!updateErr && updatedData) {
        await finalizeAcceptance();
        return res.json({ message: 'Escrow deposit confirmed (recovered).', txHash: result.txHash });
      }
      return res.status(202).json({ message: 'Escrow deposit confirmed on-chain. Database sync pending.', txHash: result.txHash });
    }

    if (updateErr) {
      logger.error('[confirm-deposit] DB update failed:', updateErr.message);
      return res.status(500).json({ error: 'Database update failed after deposit confirmation. Please contact support.' });
    }

    const { data, error } = await orderRepository.createBid(bidData);
    if (error) {
      logger.error('[submit-bid] Failed to insert bid:', error.message);
      return res.status(500).json({ error: 'Failed to submit bid' });
    }

    return res.status(201).json({ message: 'Bid submitted successfully', bid: data });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[submit-bid] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});
  } finally {
    if (lockValue) {
      await releaseLock(lockKey, lockValue).catch(() => { });
    }
    if (lock && typeof lock.release === 'function') {
      await lock.release().catch(() => { });
    }
  }
});


// ============================================================================
// 18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: View all bids for a specific order
 *     description: Allows the order owner or admin to review submitted driver bids.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *       200:
 *         description: List of bids retrieved successfully
 *       403:
 *         description: Unauthorized to view bids for this order
 *       404:
 *         description: Order not found
 */
router.get('/:id/bids', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const userId = req.user.id;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized access to order bids' });
    }

    const { data: bids, error } = await orderRepository.findBidsByOrderId(orderId);
    if (error) {
      logger.error('[get-bids] Failed to retrieve bids:', error.message);
      return res.status(500).json({ error: 'Failed to fetch bids' });
    }

    return res.status(200).json({ bids });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[get-bids] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Orders]
 *     summary: Accept a specific driver bid
 *     description: Assigns the order to the winning driver and rejects other pending bids.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: path
 *         name: bidId
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Bid accepted successfully and order assigned
 *       400:
 *         description: Bid is already expired or invalid
 *       403:
 *         description: Unauthorized action
 *       404:
 *         description: Order or bid not found
 */
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { bidId } = req.params;
    const userId = req.user.id;

    const order = await orderRepository.findOrderById(orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }

    if (order.customer_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Unauthorized to accept bids for this order' });
    }

    const result = await orderRepository.acceptBidTransaction(orderId, bidId);
    if (result.error) {
      logger.error('[accept-bid] Transaction failed:', result.error.message);
      return res.status(400).json({ error: result.error.message || 'Failed to accept bid' });
    }

    return res.status(200).json({
      message: 'Bid accepted successfully',
      order: result.order,
      acceptedBid: result.bid,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[accept-bid] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

module.exports = router;
