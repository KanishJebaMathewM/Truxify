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
