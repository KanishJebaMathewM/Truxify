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
  getOrderTimeline,
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

const router = express.Router();
const MAX_GEOFENCE_RADIUS_M = 500;

const injectOtpIdempotencyKey = (req, res, next) => {
  if (req.body && req.body.otp && req.params.id) {
    const otpHash = crypto.createHash('sha256').update(String(req.body.otp).trim()).digest('hex');
    req.headers['x-idempotency-key'] = `${req.params.id}-${otpHash}`;
  }
  next();
};

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
 *     description: Returns available load offers ranked for an en-route (deadhead) match using the Deadhead Eliminator ML model, falling back to a haversine-distance ranking when the ML engine is unavailable.
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
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 loads:
 *                   type: array
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
/**
 * @openapi
 * /api/orders/{id}/verify-delivery:
 *   post:
 *     tags: [Orders]
 *     summary: Verify delivery with OTP
 *     description: Verifies delivery completion using OTP. Idempotent for 24 hours. Rate-limited to 20 attempts per 15 minutes.
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
 *         description: Delivery verified
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/VerifyDeliveryResponse'
 *       429:
 *         description: Rate limited
 */
router.post('/:id/verify-delivery', authenticate, userLimiter, requirePolicy('delivery:verify'), auditLog({ action: 'delivery:verify', resourceType: 'delivery_verification' }), verifyDeliveryLimiter, injectOtpIdempotencyKey, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
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
/**
 * @openapi
 * /api/orders/{id}/geofence-confirm:
 *   post:
 *     tags: [Orders]
 *     summary: Auto-confirm delivery via GPS geofence
 *     description: |
 *       If the driver's GPS position is within 500m of the drop location,
 *       automatically confirms delivery and releases escrow payment without
 *       requiring the customer to share an OTP. Falls back gracefully if
 *       the driver is too far away (returns autoConfirmed: false).
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
 *             type: object
 *             required: []
         properties:
        geofence_radius_m:
    type: number
    description: Override default 500m geofence radius
 *               geofence_radius_m:
 *                 type: number
 *                 description: Override default 500m geofence radius
 *     responses:
 *       200:
 *         description: Auto-confirm result (check autoConfirmed field)
 *       409:
 *         description: Order not in arriving status
 */
router.post(
  '/:id/geofence-confirm',
  authenticate,
  userLimiter,
  requirePolicy('delivery:verify'),
  validateParams(paramIdSchema),
  async (req, res) => {
    try {
      const { geofence_radius_m } = req.body;

      let geofenceRadiusM = 500;

      if (
        geofence_radius_m !== undefined &&
        geofence_radius_m !== null &&
        geofence_radius_m !== ''
      ) {
        const parsedRadius = parseFloat(geofence_radius_m);

        if (
          !Number.isFinite(parsedRadius) ||
          parsedRadius <= 0 ||
          parsedRadius > MAX_GEOFENCE_RADIUS_M
        ) {
          return res.status(400).json({
            error: `geofence_radius_m must be between 0 and ${MAX_GEOFENCE_RADIUS_M} meters.`,
          });
        }

        geofenceRadiusM = parsedRadius;
      }

      if (!req.params.id || !req.params.id.trim()) {
        return res.status(400).json({
          error: 'Invalid order id',
        });
      }

      const order = await orderValidationService.findOrderByIdOrDisplayId(
        req.params.id,
        'id, driver_id, customer_id'
      );

      orderValidationService.assertOrderFound(order);
      orderValidationService.assertDriverAssignment(order, req.user.id);

      if (!mongoDb) {
        return res.status(503).json({
          error: 'Telemetry database not available.',
        });
      }

      const latestTelemetry = await mongoDb
        .collection('telemetry')
        .find({
          driver_id: order.driver_id,
          order_id: order.id,
        })
        .sort({ timestamp: -1 })
        .limit(1)
        .toArray();

      if (!latestTelemetry || latestTelemetry.length === 0) {
        return res.status(404).json({
          error: 'No live telemetry found for this driver.',
        });
      }

      const telemetry = latestTelemetry[0];

      const lat = Number(telemetry.lat);
      const lng = Number(telemetry.lng);

      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        return res.status(404).json({
          error: 'Latest telemetry record contains invalid coordinates.',
        });
      }

      const telemetryTime = new Date(telemetry.timestamp).getTime();
      const telemetryAge = Date.now() - telemetryTime;
      const MAX_TELEMETRY_AGE_MS = 5 * 60 * 1000;

      if (
        !Number.isFinite(telemetryTime) ||
        telemetryAge < 0 ||
        telemetryAge > MAX_TELEMETRY_AGE_MS
      ) {
        return res.status(409).json({
          error: 'Driver location is not recent enough for geofence confirmation.',
        });
      }

      const result =
        await orderLifecycleService.deliveryVerification.geofenceAutoConfirm({
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

      logger.error(
        'Geofence auto-confirm exception:',
        err.message
      );

      return res.status(500).json({
        error: 'Internal Server Error',
      });
    }
  }
);

// 5. FETCH MY ORDER HISTORY (CUSTOMER)
router.get('/history', authenticate, userLimiter, requireRole(['customer']), getOrderHistory);

// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), getOrderDetails);

// 6b. FETCH ORDER TIMELINE (CUSTOMER OR ASSIGNED DRIVER)
router.get('/:id/timeline', authenticate, userLimiter, validateParams(paramIdSchema), getOrderTimeline);

// 13c. DRIVER OTP CONFIRM ALIAS — POST /api/orders/:id/confirm-otp
// Friendly alias of /:id/verify-delivery for the driver app. It accepts the
// same body { otp } and delegates to the identical pipeline so the driver's
// Confirm Delivery flow can release the escrow and credit the wallet.
router.post('/:id/confirm-otp', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, injectOtpIdempotencyKey, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), verifyDeliveryController);

// 14. RESEND DELIVERY OTP (DRIVER)
router.post('/:id/resend-otp', authenticate, userLimiter, resendOtpLimiter, requireRole(['driver']), validateParams(paramIdSchema), resendOtp);

// 15. CHANGE DROP (CUSTOMER)
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(changeDropSchema), changeDrop);

// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), cancelOrder);

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
router.post('/:id/confirm-deposit', authenticate, userLimiter, requirePolicy('order:confirm-deposit'), auditLog({ action: 'order:confirm-deposit', resourceType: 'order' }), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(
  z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') }),
), async (req, res) => {
  const orderId = req.params.id;
  const { txHash } = req.body;

  const lockKey = `escrow_lock:${orderId}`;
  let lockValue = null;
  try {
    // Financial mutations require the distributed lock. A local fallback
    // cannot exclude another API instance when Redis is unavailable.
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

    if (!updatedData) {
      logger.error('[confirm-deposit] No row updated — escrow_status may not have been "funding"');
      return res.status(409).json({ error: 'Order was not in funding state. Please refresh and try again.' });
    }

    await finalizeAcceptance();
    invalidateBookingCaches().catch(err => logger.error({ err }, 'Failed to invalidate cache on confirm deposit'));
    res.json({ message: 'Escrow deposit confirmed', txHash: result.txHash });
  } catch (err) {
    if (err instanceof LockAcquisitionError) {
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
      await releaseLock(lockKey, lockValue).catch((releaseErr) => {
        logger.error('[confirm-deposit] Failed to release order lock:', releaseErr.message);
      });
    }
  }
}); 
// Path 1: Already funded or confirmation path handling
if (alreadyFunded) {
  const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(
    orderId, 
    {
      escrow_status: 'funded',
      escrow_funding_error: null,
      version: order.version + 1,
      updated_at: new Date().toISOString(),
    }, 
    [
      { op: 'eq', column: 'escrow_status', value: 'funding' },
      { op: 'eq', column: 'version', value: order.version }
    ], 
    'id'
  );

  if (updateErr) {
    return res.status(500).json({ success: false, error: updateErr.message });
  }
} else {
  // Path 2: Standard confirm deposit success path
  const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(
    orderId, 
    {
      escrow_status: 'funded',
      escrow_funding_error: null,
      version: order.version + 1,
      updated_at: new Date().toISOString(),
    }, 
    [
      { op: 'eq', column: 'escrow_status', value: 'funding' },
      { op: 'eq', column: 'version', value: order.version }
    ], 
    'id'
  );

  if (updateErr) {
    return res.status(500).json({ success: false, error: updateErr.message });
  }
}
router.post('/:id/confirm-deposit', authenticate, async (req, res, next) => {
     const orderId = req.params.id;
     
     try {
       const result = await escrowLockManager.withLock(orderId, async (ctx) => {
         // SINGLE READ - no more duplicate readOrder() calls
         const { data: order, error } = await orderRepository.findOrderById(orderId);
         if (error || !order) {
           throw new DomainError(404, { error: 'Order not found' });
         }
         
         // Resolve expected deposit amount once
         const expectedAmount = resolveExpectedDepositAmount(order);
         
         // Transition to confirming state
         const transitionResult = await ctx.transition('confirming');
         if (!transitionResult.success) {
           throw new DomainError(409, { error: 'Invalid state transition' });
         }
         
         // Verify on-chain deposit
         const depositTx = await recordDepositTx(order, expectedAmount);
         
         try {
           // Execute acceptance RPC (may take time)
           await finalizeAcceptance(order, depositTx);
           
           // Transition to funded
           await ctx.transition('funded');
           
           // Update DB atomically
           await orderRepository.updateOrder(orderId, {
             escrow_status: 'funded',
             deposit_tx_hash: depositTx.hash
           });
           
           return { success: true, txHash: depositTx.hash };
         } catch (rpcError) {
           // EXTEND LOCK for refund processing
           await ctx.extend();
           
           // Transition to refund_pending
           await ctx.transition('refund_pending');
           
           // Execute refund WHILE HOLDING LOCK
           const refundResult = await submitEscrowRefund(orderId, depositTx);
           
           // Transition to refunded
           await ctx.transition('refunded');
           
           await orderRepository.updateOrder(orderId, {
             escrow_status: 'refunded',
             refund_tx_hash: refundResult.txHash
           });
           
           throw new DomainError(500, { 
             error: 'Acceptance failed, refund processed',
             refundTxHash: refundResult.txHash 
           });
         }
       }, { 
         expectedState: 'funding',
         targetState: 'confirming'
       });
       
       res.json(result);
     } catch (err) {
       next(err);
     }
   });


//  ============================================================================
//  18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
//  18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
//  18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
});

//  ============================================================================
//  18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
//  18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
//  18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept

// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid for an order / load offer
 *     description: Allows an authenticated driver to submit a freight bid for an available load.
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
 *         description: Invalid input or validation failure
 *       403:
 *         description: Unauthorized role (driver required)
 */
router.post(
  '/:id/bids',
  authenticate,
  userLimiter,
  bidLimiter,
  requireRole(['driver']),
  requirePolicy('bid:submit'),
  validateParams(paramIdSchema),
  validateBody(submitBidSchema),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const { amount } = req.body;
      const driverId = req.user.id;

      const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, status');
      orderValidationService.assertOrderFound(order);

      const bid = await orderLifecycleService.submitBid({
        orderId: order.id,
        driverId,
        amount,
      });

      return res.status(201).json({
        message: 'Bid submitted successfully.',
        bid,
      });
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('Submit bid exception:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ============================================================================
// 18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: View submitted bids for an order
 *     description: Allows the order owner (customer) to view all active bids submitted for their order.
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
 *         description: List of bids retrieved successfully
 */
router.get(
  '/:id/bids',
  authenticate,
  userLimiter,
  requireRole(['customer']),
  validateParams(paramIdSchema),
  async (req, res) => {
    try {
      const orderId = req.params.id;
      const customerId = req.user.id;

      const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id');
      orderValidationService.assertOrderFound(order);
      orderValidationService.assertCustomerOwnership(order, customerId);

      const bids = await orderLifecycleService.getBidsForOrder(order.id);

      return res.json({ bids });
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('View bids exception:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ============================================================================
// 18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Orders]
 *     summary: Accept a driver bid
 *     description: Allows the customer to accept a specific driver bid, triggering escrow initialization.
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
 *         description: Bid accepted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AcceptBidResponse'
 */
router.post(
  '/:id/bids/:bidId/accept',
  authenticate,
  userLimiter,
  requireRole(['customer']),
  requirePolicy('bid:accept'),
  requireIdempotency(3600),
  validateParams(
    z.object({
      id: z.string().uuid('Invalid order ID format'),
      bidId: z.string().uuid('Invalid bid ID format'),
    })
  ),
  async (req, res) => {
    const orderId = req.params.id;
    const bidId = req.params.bidId;
    const customerId = req.user.id;

    const lockKey = `bid_accept_lock:${orderId}`;
    const lock = await acquireLockOrFallback(lockKey, 30000);
    if (!lock.ok) {
      return res.status(409).json({ error: 'Another bid acceptance is in progress for this order. Please try again.' });
    }

    try {
      const order = await orderValidationService.findOrderByIdOrDisplayId(
        orderId,
        'id, customer_id, status, order_display_id'
      );
      orderValidationService.assertOrderFound(order);
      orderValidationService.assertCustomerOwnership(order, customerId);

      const result = await orderLifecycleService.acceptBid({
        orderId: order.id,
        bidId,
        customerId,
      });

      sendPushNotification(
        result.driver_id,
        'Bid Accepted!',
        `Your bid for order ${order.order_display_id} has been accepted. Please fund escrow to proceed.`,
        'order_update',
        { orderId: order.id, orderDisplayId: order.order_display_id }
      ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err?.message}`));

      return res.json({
        message: 'Bid accepted successfully. Please proceed with escrow deposit.',
        order: result,
      });
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('Accept bid exception:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    } finally {
      if (lock && typeof lock.release === 'function') {
        await lock.release().catch(() => {});
      }
    }
  }
);

// POST /api/orders/:id/ratings
router.post('/:id/ratings', authenticate, userLimiter, requirePolicy('order:submit-rating', async (req) => {
  const { data: order } = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), auditLog({ action: 'order:submit-rating', resourceType: 'order_rating' }), validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.submitRating(
      req.params.id,
      req.user.id,
      req.body.stars,
      req.body.comment ?? null,
      req.token ? createUserClient(req.token) : undefined
    );
    return res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Submit rating exception:', err?.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});


export default router;
