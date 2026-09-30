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

// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), getActiveOrders);

// 3. FETCH LOAD OFFERS (MARKETPLACE)
router.get('/load-offers', authenticate, userLimiter, getLoadOffers);

// ============================================================================
// 12. UPDATE ORDER MILESTONE (ASSIGNED DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/milestones:
 *   put:
 *     tags: [Orders]
 *     summary: Update order milestones
 *     description: Updates the milestone status for an order. Rate-limited to 5 updates per minute per driver.
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
 *             $ref: '#/components/schemas/UpdateMilestoneRequest'
 *     responses:
 *       200:
 *         description: Milestone updated
 *       429:
 *         description: Rate limited
 */
router.put('/:id/milestones', authenticate, userLimiter, requirePolicy('milestone:update'), milestoneLimiter, requireIdempotency(3600), validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;

  const lockKey = `milestone_lock:${orderId}`;
  const lock = await acquireLockOrFallback(lockKey, 10000);
  if (!lock.ok) {
    return res.status(409).json({ error: 'Another milestone update is in progress for this order. Please try again.' });
  }

  try {
    if (milestone === 'Delivered') {
      return res.status(400).json({ error: 'Cannot set Delivered milestone directly. Use /verify-delivery endpoint to confirm delivery.' });
    }

    const result = await orderMilestoneService.updateMilestone({ orderId, milestone, driverId: req.user.id });
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error(err, "[orderRoutes] Milestone update error:");
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    await lock.release();
  }
});

// ============================================================================
// 12b. FETCH EN-ROUTE LOAD OFFERS (DRIVER) — GET /api/orders/load-offers/en-route
// ============================================================================
/**
 * @openapi
 * /api/orders/load-offers/en-route:
 *   get:
 *     tags: [Orders]
 *     summary: List en-route / deadhead load opportunities
 *     description: Returns available load offers ranked for an en-route (deadhead) match.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: query
 *         name: current_lat
 *         schema:
 *           type: number
 *       - in: query
 *         name: current_lng
 *         schema:
 *           type: number
 *       - in: query
 *         name: max_detour_km
 *         schema:
 *           type: number
 *           default: 50
 *     responses:
 *       200:
 *         description: En-route load offers
 */
router.get('/load-offers/en-route', authenticate, userLimiter, requirePolicy('load-offer:browse'), validateQuery(z.object({
  current_lat: z.coerce.number().optional(),
  current_lng: z.coerce.number().optional(),
  max_detour_km: z.coerce.number().positive('max_detour_km must be a positive number').optional(),
})), async (req, res) => {
  try {
    const { current_lat, current_lng, max_detour_km } = req.query;

    let query = supabaseAdmin
      .from('load_offers')
      .select('*', { count: 'exact' })
      .eq('status', 'available');

    query = query.order('created_at', { ascending: false });

    const { data: offers, error } = await query;
    if (error) {
      logger.error('Failed to fetch en-route load offers:', error);
      return res.status(500).json({ error: 'Failed to fetch en-route load offers.' });
    }

    const formattedOffers = (offers || []).map(offer => ({
      ...offer,
      pickup: offer.pickup_address,
      destination: offer.drop_address,
      estimated_price: offer.freight_value / 100,
      vehicle_type: 'Truck',
    }));

    let loads = formattedOffers;

    if (current_lat !== undefined && current_lng !== undefined) {
      loads = await matchEnRouteLoads({
        currentLat: Number(current_lat),
        currentLng: Number(current_lng),
        offers: formattedOffers,
        maxDetourKm: max_detour_km !== undefined ? Number(max_detour_km) : 50,
      });
    }

    return res.json({ loads });
  } catch (err) {
    logger.error('Internal Server Error in GET /api/orders/load-offers/en-route:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
// ============================================================================
router.post('/:id/verify-delivery', authenticate, userLimiter, requirePolicy('delivery:verify'), auditLog({ action: 'delivery:verify', resourceType: 'delivery_verification' }), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
  try {
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(req.params.id, req.user.id, req.body.otp, req.token ? createUserClient(req.token) : undefined);

    if (escrowUpdateFailed) {
      return res.status(202).json({
        message: 'Delivery verified successfully. Escrow payout requires reconciliation.',
        escrow_status: 'released',
        payment_released: true,
      });
    }

    res.json({ message: 'Delivery verified successfully! Payment released to driver.' });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[verify-delivery] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13b. GPS GEOFENCE AUTO-CONFIRM DELIVERY (DRIVER)
// ============================================================================
router.post(
  '/:id/geofence-confirm',
  authenticate,
  userLimiter,
  requirePolicy('delivery:verify'),
  validateParams(paramIdSchema),
  async (req, res) => {
    try {
      const { driver_lat, driver_lng, geofence_radius_m } = req.body;

      if (!driver_lat || !driver_lng) {
        return res.status(400).json({ error: 'driver_lat and driver_lng are required.' });
      }

      const lat = parseFloat(driver_lat);
      const lng = parseFloat(driver_lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(400).json({ error: 'driver_lat and driver_lng must be valid numbers.' });
      }

      let geofenceRadiusM = 500;
      if (geofence_radius_m !== undefined && geofence_radius_m !== null && geofence_radius_m !== '') {
        const parsedRadius = parseFloat(geofence_radius_m);
        if (!Number.isFinite(parsedRadius) || parsedRadius <= 0 || parsedRadius > MAX_GEOFENCE_RADIUS_M) {
          return res.status(400).json({ error: `geofence_radius_m must be between 0 and ${MAX_GEOFENCE_RADIUS_M} meters.` });
        }
        geofenceRadiusM = parsedRadius;
      }

      const order = await orderValidationService.findOrderByIdOrDisplayId(
        req.params.id,
        'id, driver_id, customer_id'
      );
      orderValidationService.assertOrderFound(order);
      orderValidationService.assertDriverAssignment(order, req.user.id);

      const result = await orderLifecycleService.deliveryVerification.geofenceAutoConfirm({
        orderId: order.id,
        driverId: req.user.id,
        driverLat: lat,
        driverLng: lng,
        geofenceRadiusM,
      });

      return res.json(result);
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('Geofence auto-confirm exception:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// 5. FETCH MY ORDER HISTORY (CUSTOMER)
router.get('/history', authenticate, userLimiter, requireRole(['customer']), getOrderHistory);

// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), getOrderDetails);

// 13c. DRIVER OTP CONFIRM ALIAS
router.post('/:id/confirm-otp', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), verifyDeliveryController);

// 14. RESEND DELIVERY OTP (DRIVER)
router.post('/:id/resend-otp', authenticate, userLimiter, resendOtpLimiter, requireRole(['driver']), validateParams(paramIdSchema), resendOtp);

// 15. CHANGE DROP (CUSTOMER)
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(changeDropSchema), changeDrop);

// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), cancelOrder);

// ============================================================================
// 17. CONFIRM ESCROW DEPOSIT (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/confirm-deposit:
 *   post:
 *     tags: [Orders]
 *     summary: Confirm escrow deposit
 *     description: Confirms that an escrow deposit transaction has been completed for an order.
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
 *         description: Deposit confirmed
 */
router.post(
  '/:id/confirm-deposit',
  authenticate,
  userLimiter,
  requirePolicy('order:confirm-deposit'),
  auditLog({ action: 'order:confirm-deposit', resourceType: 'order' }),
  requireIdempotency(86400),
  validateParams(paramIdSchema),
  validateBody(
    z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') })
  ),
  async (req, res, next) => {
    const orderId = req.params.id;
    const { txHash } = req.body;
router.post('/:id/confirm-deposit', authenticate, userLimiter, requirePolicy('order:confirm-deposit'), auditLog({ action: 'order:confirm-deposit', resourceType: 'order' }), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(
  z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') }),
), async (req, res) => {
  const orderId = req.params.id;
  const { txHash } = req.body;

  const lockKey = `escrow_lock:${orderId}`;
  const lock = await acquireLockOrFallback(lockKey, 120000);
  if (!lock.ok) {
    return res.status(409).json({ error: 'Another deposit confirmation is in progress for this order. Please try again.' });
  }

  let lockValue = null;
  try {
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

    try {
      const result = await escrowLockManager.withLock(orderId, async (ctx) => {
        const order = await orderRepository.findOrderById(orderId);
        const orderData = order?.data || order;
        if (!orderData) {
          throw new DomainError(404, { error: 'Order not found' });
        }

        const expectedAmount = resolveExpectedDepositAmount(orderData);
        
        const transitionResult = await ctx.transition('confirming');
        if (!transitionResult.success) {
          throw new DomainError(409, { error: 'Invalid state transition for deposit confirmation' });
        }

        const depositTx = await recordDepositTx(bookingId, txHash, customerWallet, orderData.escrow_driver_wallet ?? null, expectedAmount.expectedAmountWei);
        if (depositTx.error) {
          throw new DomainError(422, { error: depositTx.error, code: depositTx.code });
        }

        try {
          await ctx.transition('funded');
          await orderRepository.updateOrder(orderId, {
            escrow_status: 'funded',
            deposit_tx_hash: depositTx.hash || txHash
          });

          invalidateBookingCaches().catch(err => logger.error({ err }, 'Failed to invalidate cache'));
          return { success: true, txHash: depositTx.hash || txHash };
        } catch (rpcError) {
          await ctx.extend();
          await ctx.transition('refund_pending');

          const refundResult = await submitEscrowRefund(orderId, depositTx);
          await ctx.transition('refunded');

          await orderRepository.updateOrder(orderId, {
            escrow_status: 'refunded',
            refund_tx_hash: refundResult.txHash
          });
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

    if (!updatedData) {
      logger.error('[confirm-deposit] No row updated — escrow_status may not have been "funding"');
      return res.status(409).json({ error: 'Order was not in funding state. Please refresh and try again.' });
    }

    await finalizeAcceptance();
    invalidateBookingCaches().catch(err => logger.error({ err }, 'Failed to invalidate cache on confirm deposit'));
    res.json({ message: 'Escrow deposit confirmed', txHash: result.txHash });
  } catch (err) {
    if (err instanceof LockAcquisitionError) {
      // Redis is down — do NOT proceed with the deposit mutation.
      logger.error('[confirm-deposit] Redis unavailable — refusing deposit confirmation:', err.message);
      return res.status(503).json({ error: 'Payment service temporarily unavailable. Please retry in a moment.' });
    }
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[confirm-deposit] Exception:', err?.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    if (lockValue) {
      await releaseLock(lockKey, lockValue).catch(() => { });
    }
    if (lock && typeof lock.release === 'function') {
      await lock.release().catch(() => { });
    }
  }
});


//  ============================================================================
//  18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
//  18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
//  18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: List bids for an order
 *     description: Returns the pending bids for the authenticated customer's order, enriched with driver and truck info.
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
 *         description: Enriched bid list
 *       403:
 *         description: Forbidden for non-owner
 */
router.get('/:id/bids', authenticate, userLimiter, requirePolicy('order:view-bids'), validateParams(paramIdSchema), async (req, res) => {
  try {
    const bids = await orderLifecycleService.getBidsForOrder(req.params.id, req.user.id);
    return res.json(bids);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Failed to fetch bids:', err?.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid for a load offer
 *     description: Allows an authenticated driver to submit a bid on an available load offer. Rate-limited per driver.
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
 *         description: Bid submitted
 *       400:
 *         description: Validation error
 *       403:
 *         description: Forbidden (bidding on own load)
 *       404:
 *         description: Load offer not found
 *       409:
 *         description: Duplicate pending bid
 *       410:
 *         description: Load no longer available
 */
router.post('/:id/bids', authenticate, userLimiter, requirePolicy('bid:submit'), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const { bid_amount } = req.body;
    const result = await orderLifecycleService.submitBid(req.params.id, req.user.id, bid_amount);
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Failed to submit bid:', err?.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
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
 *     summary: Accept a bid
 *     description: Reserves a bid for the order and returns the escrow deposit transaction for the customer to sign. Two-phase — the driver is assigned only after the deposit is confirmed.
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
 *         description: Bid reserved with escrow deposit transaction
 *       403:
 *         description: Forbidden (bid not on this order)
 *       404:
 *         description: Order or bid not found
 *       422:
 *         description: Missing wallet
 */
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requirePolicy('order:accept-bid'), auditLog({ action: 'order:accept-bid', resourceType: 'order' }), requireIdempotency(86400), validateParams(acceptBidParamsSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.acceptBid(req.params.id, req.params.bidId, req.user.id);
    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Bid acceptance exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18. PREDICT RIDE DEMAND (CUSTOMER OR DRIVER)
router.post('/predict-demand', authenticate, userLimiter, requireRole(['customer', 'driver']), predictDemandLimiter, validateBody(predictDemandSchema), predictRideDemand);

// 19. GET DRIVER LOCATION (CUSTOMER OR DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/driver-location:
 *   get:
 *     tags: [Orders]
 *     summary: Get driver's current location
 *     description: Returns the current GPS location of the driver assigned to an order.
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
 *         description: Driver location
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/DriverLocationResponse'
 */
router.get('/:id/driver-location', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-driver-location', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id, driver_id, status');
    orderValidationService.assertOrderFound(order);

    if (!order.driver_id) {
      return res.status(404).json({ error: 'No driver assigned to this order.' });
    }

    if (!mongoDb) {
      return res.status(503).json({ error: 'Telemetry database not available.' });
    }

    const latestTelemetry = await mongoDb
      .collection('telemetry')
      .find({ driver_id: order.driver_id, order_id: order.id })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (!latestTelemetry || latestTelemetry.length === 0) {
      return res.status(404).json({ error: 'No live telemetry found for this driver.' });
    }

    const telemetry = latestTelemetry[0];
    return res.json({
      driverId: telemetry.driver_id,
      orderId: telemetry.order_id || order.id,
      lat: telemetry.lat,
      lng: telemetry.lng,
      timestamp: telemetry.timestamp,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err }, 'Fetch driver location exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-route', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id, driver_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng');
    orderValidationService.assertOrderFound(order);

    if (order.drop_lat == null || order.drop_lng == null) {
      return res.status(500).json({ error: 'Order is missing destination coordinates.' });
    }

    if (!order.driver_id) {
      const originLat = Number(order.pickup_lat);
      const originLng = Number(order.pickup_lng);
      const destLat = Number(order.drop_lat);
      const destLng = Number(order.drop_lng);

      if (!Number.isFinite(originLat) || !Number.isFinite(originLng) ||
        !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        return res.status(500).json({ error: 'Order has invalid coordinates.' });
      }

      const feature = buildStraightLineGeometry({ originLat, originLng, destLat, destLng });
      if (!feature) {
        return res.status(500).json({ error: 'Failed to compute route.' });
      }
      return res.json({ ...feature, fallback: true });
    }

    if (!mongoDb) {
      return res.status(503).json({ error: 'Telemetry database not available.' });
    }

    const latestTelemetry = await mongoDb
      .collection('telemetry')
      .find({ driver_id: order.driver_id, order_id: order.id })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (!latestTelemetry || latestTelemetry.length === 0) {
      return res.status(404).json({ error: 'No live telemetry found for this driver.' });
    }

    const originLat = Number(latestTelemetry[0].lat);
    const originLng = Number(latestTelemetry[0].lng);

    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return res.status(404).json({ error: 'Latest telemetry record is missing valid coordinates.' });
    }

    const destLat = Number(order.drop_lat);
    const destLng = Number(order.drop_lng);

    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      logger.error(`[route] Order ${order.id} has non-numeric destination coordinates.`);
      return res.status(500).json({ error: 'Order has invalid destination coordinates.' });
    }

    let feature = await getRouteGeometry({ originLat, originLng, destLat, destLng });
    let usedFallback = false;

    if (!feature) {
      logger.warn(`[route] OSRM unavailable for order ${order.id}, falling back to straight line.`);
      feature = buildStraightLineGeometry({ originLat, originLng, destLat, destLng });
      usedFallback = true;
    }

    if (!feature) {
      return res.status(502).json({ error: 'Failed to compute route.' });
    }

    return res.json({ ...feature, fallback: usedFallback });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err }, 'Fetch order route exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

const POD_ALLOWED_MIME_TYPES = ['image/jpeg', 'image/png'];
const POD_MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

const podUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: POD_MAX_FILE_SIZE },
  fileFilter: (_req, file, cb) => {
    if (POD_ALLOWED_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(null, false);
    }
  },
});

function computeFileHash(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function validateAndScanPodFile(file, label) {
  validateDocumentBuffer(file.buffer, file.mimetype);
  const scanResult = await scanDocument(file.buffer);

  if (!scanResult.clean) {
    const err = new Error(`${label} file failed malware scanning.`);
    err.status = 422;
    throw err;
  }
}

// POST /api/orders/:id/pod
// PoD uploads are rate-limited per driver + order: each request may carry up to
// 20MB and triggers a malware scan, so without a limiter a driver could exhaust
// storage, RAM (multer memoryStorage), and scan CPU with an unbounded stream.
router.post('/:id/pod', authenticate, requireRole(['driver']), podUploadLimiter, requireIdempotency(86400), podUpload.fields([{ name: 'signature', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { data: order, error: orderErr } = await orderRepository.findOrderById(orderId);

    if (orderErr || !order) return res.status(404).json({ error: 'Order not found' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: Not your order' });

    let signatureUrl = order.pod_signature_url;
    let photoUrl = order.pod_photo_url;
    let signatureHash = order.pod_signature_hash || null;
    let photoHash = order.pod_photo_hash || null;
    const files = req.files || {};

    let uploadedAny = false;

          throw new DomainError(500, {
            error: 'Acceptance failed, escrow refunded safely',
            refundTxHash: refundResult.txHash
          });
        }
      }, {
        expectedState: 'funding',
        targetState: 'confirming'
      });

      return res.json(result);
    } catch (err) {
      if (err instanceof LockAcquisitionError) {
        logger.error('[confirm-deposit] Redis unavailable:', err.message);
        return res.status(503).json({ error: 'Payment service temporarily unavailable. Please retry.' });
      }
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('[confirm-deposit] Exception:', err?.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

export default router;
