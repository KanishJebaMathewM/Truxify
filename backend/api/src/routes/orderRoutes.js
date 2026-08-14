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
import rateLimit from 'express-rate-limit';
import { z } from 'zod';

import { bidLimiter, userLimiter, safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
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
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLock, releaseLock } from '../lib/redisLock.js';
import logger from '../middleware/logger.js';
import { auditLog } from '../middleware/auditLog.js';
import {
  createOrder,
  getActiveOrders,
  getLoadOffers,
  getEnRouteLoads,
  getOrderHistory,
  getOrderDetails,
  getOrderTimeline,
  submitBid,
  submitRating,
  getBids,
  acceptBid,
  updateMilestone,
  verifyDeliveryController,
  resendOtp,
  changeDrop,
  cancelOrder,
  confirmDeposit,
  predictRideDemand,
  getDriverLocation,
  getLiveRouteGeometry,
} from '../controllers/orderController.js';

const router = express.Router();

const verifyDeliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:verify-delivery:'),
  message: { error: 'Too many delivery verification attempts. Please try again later.' },
});

const milestoneLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyGenerator: (req) => req.user.id,
  store: createStore('rl:milestone:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many milestone updates. Please slow down.' },
});

import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';


const getOrderResource = async (req) => {
  const { id } = req.params;
  if (!id) return null;
  return await orderRepository.findOrderById(id);
};


router.post('/:id/geofence-confirm', authenticate, requireRole(['driver']), async (req, res) => {
  const { driver_lat, driver_lng, geofence_radius_m } = req.body;

// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), getActiveOrders);

// 3. FETCH LOAD OFFERS (MARKETPLACE)
router.get('/load-offers', authenticate, userLimiter, getLoadOffers);

  if (!req.params.id || !req.params.id.trim()) {
    return res.status(400).json({ error: 'Invalid order id' });
  }
  let geofenceRadiusM;
  if (geofence_radius_m !== undefined) {
    geofenceRadiusM = parseFloat(geofence_radius_m);
    if (!Number.isFinite(geofenceRadiusM) || geofenceRadiusM <= 0) {
      return res.status(400).json({ error: 'Invalid geofence_radius_m' });
    }
  }

// 5. FETCH MY ORDER HISTORY (CUSTOMER)
router.get('/history', authenticate, userLimiter, requireRole(['customer']), getOrderHistory);

// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), getOrderDetails);

// 7. FETCH ORDER TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id/timeline', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

// ============================================================================
// 13b. FETCH EN-ROUTE LOAD OFFERS (DRIVER) — GET /api/orders/load-offers/en-route
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

    // load_offers is RLS-protected with all anon privileges revoked, so the
    // marketplace board must read through the service-role client.
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

    // Rank the offers for an en-route match only when the driver's current
    // position is provided; otherwise return all available offers unsorted.
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
// 13c. DRIVER OTP CONFIRM ALIAS — POST /api/orders/:id/confirm-otp
// ============================================================================
/**
 * Friendly alias of /:id/verify-delivery for the driver app.
 * Accepts the same body { otp } and delegates to the same pipeline.
 * Registered on the orders router as /:id/confirm-otp, exposed to the driver
 * app at /api/orders/:id/confirm-otp via the /api/orders mount in index.js.
 *
 * This keeps the driver app URL surface clean while reusing identical logic.
 */
const handleDeliveryVerification = async (req, res) => {
  try {
    let order = null;
    if (UUID_RE.test(orderId)) {
      const { data: orderById } = await orderRepository.findOrderForTimeline(orderId);
      order = orderById;
    }
    if (!order) {
      const { data: orderByDisplay } = await orderRepository.findOrderByDisplayForTimeline(orderId);
      order = orderByDisplay;
    }

    if (!order) return res.status(404).json({ error: 'Order not found.' });

// 8. SUBMIT BID FOR LOAD OFFER (DRIVER)
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), submitBid);

// 9. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
router.post('/:id/ratings', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(submitRatingSchema), submitRating);

// 10. VIEW BIDS FOR AN ORDER (CUSTOMER)
router.get('/:id/bids', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), getBids);

// 11. ACCEPT BID (CUSTOMER)
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(acceptBidParamsSchema), acceptBid);

// 12. UPDATE ORDER MILESTONE (ASSIGNED DRIVER)
router.put('/:id/milestones', authenticate, userLimiter, requireRole(['driver']), milestoneLimiter, validateParams(paramIdSchema), validateBody(updateMilestoneSchema), updateMilestone);

// 13. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
router.post('/:id/verify-delivery', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), verifyDeliveryController);

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
  const lockValue = await acquireLock(lockKey, 120000);
  if (!lockValue) {
    return res.status(409).json({ error: 'Another deposit confirmation is in progress for this order. Please try again.' });
  }

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, status, order_display_id, customer_id, escrow_booking_id, escrow_status, escrow_amount_wei, escrow_driver_wallet, pending_bid_acceptance');
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
      }, req.token ? createUserClient(req.token) : undefined);
      if (acceptErr) {
        logger.error('[confirm-deposit] accept_bid_tx failed:', acceptErr.message);
        // The refund is authoritative: only claim the deposit was refunded once
        // the on-chain refund was actually submitted. escrowRefund resolves to
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
      ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err.message}`));
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

    if (result.alreadyFunded) {
      const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
        escrow_status: 'funded',
      }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');

      if (!updateErr && updatedData) {
        await finalizeAcceptance();
        return res.json({ message: 'Escrow deposit confirmed (recovered).', txHash: result.txHash });
      }
      return res.status(202).json({ message: 'Escrow deposit confirmed on-chain. Database sync pending.', txHash: result.txHash });
    }

    if (result.error) {
      return res.status(422).json({ error: result.error, code: result.code });
    }

    const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
      escrow_status: 'funded',
    }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');

    if (updateErr) {
      logger.error('[confirm-deposit] DB update failed:', updateErr.message);
      return res.status(500).json({ error: 'Database update failed after deposit confirmation. Please contact support.' });
    }

    if (!updatedData) {
      logger.error('[confirm-deposit] No row updated — escrow_status may not have been "funding"');
      return res.status(409).json({ error: 'Order was not in funding state. Please refresh and try again.' });
    }

    await finalizeAcceptance();
    res.json({ message: 'Escrow deposit confirmed', txHash: result.txHash });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[confirm-deposit] Exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    await releaseLock(lockKey, lockValue);
  }
});

// ============================================================================
// 18a. SUBMIT BID FOR A LOAD (DRIVER) — POST /api/orders/:id/bids
// 18b. VIEW BIDS FOR AN ORDER (CUSTOMER) — GET /api/orders/:id/bids
// 18c. ACCEPT A BID (CUSTOMER) — POST /api/orders/:id/bids/:bidId/accept
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
    logger.error('Failed to fetch bids:', err.message);
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
    logger.error('Failed to submit bid:', err.message);
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
router.get('/:id/driver-location', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-driver-location'), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id, driver_id, status');
    orderValidationService.assertOrderFound(order);

    if (!order.driver_id) {
      return res.status(404).json({ error: 'No driver assigned to this order.' });
    }

// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), getLiveRouteGeometry);

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

    if (files.signature && files.signature[0]) {
      const file = files.signature[0];
      try {
        await validateAndScanPodFile(file, 'Signature');
      } catch (validationErr) {
        return res.status(validationErr.status || 400).json({ error: `Invalid signature file: ${validationErr.message}` });
      }
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storagePath = `${req.user.id}/pod_sig_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('driver-documents')
        .upload(storagePath, file.buffer, { contentType: file.mimetype });
      if (upErr) {
        logger.error('Signature upload to storage failed:', upErr.message);
        return res.status(500).json({ error: 'Failed to upload signature to storage' });
      }
      signatureUrl = storagePath;
      signatureHash = computeFileHash(file.buffer);
      uploadedAny = true;
    }

    if (files.photo && files.photo[0]) {
      const file = files.photo[0];
      try {
        await validateAndScanPodFile(file, 'Photo');
      } catch (validationErr) {
        return res.status(validationErr.status || 400).json({ error: `Invalid photo file: ${validationErr.message}` });
      }
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const storagePath = `${req.user.id}/pod_photo_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('driver-documents')
        .upload(storagePath, file.buffer, { contentType: file.mimetype });
      if (upErr) {
        logger.error('Photo upload to storage failed:', upErr.message);
        return res.status(500).json({ error: 'Failed to upload photo to storage' });
      }
      photoUrl = storagePath;
      photoHash = computeFileHash(file.buffer);
      uploadedAny = true;
    }

    if (!uploadedAny) {
      return res.status(400).json({ error: 'At least one valid proof file (signature or photo) is required' });
    }

    const updates = {
      updated_at: new Date().toISOString(),
    };
    if (signatureUrl !== order.pod_signature_url) updates.pod_signature_url = signatureUrl;
    if (photoUrl !== order.pod_photo_url) updates.pod_photo_url = photoUrl;
    if (signatureHash) updates.pod_signature_hash = signatureHash;
    if (photoHash) updates.pod_photo_hash = photoHash;

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrder(orderId, updates);

    if (updateErr) {
      logger.error('Failed to update order with PoD:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update order with PoD data' });
    }

    return res.json({
      message: 'Proof of Delivery uploaded successfully',
      photoUrl: updatedOrder.pod_photo_url,
      signatureUrl: updatedOrder.pod_signature_url,
      photoHash: updatedOrder.pod_photo_hash,
      signatureHash: updatedOrder.pod_signature_hash,
      uploadTimestamp: updatedOrder.updated_at,
    });
  } catch (err) {
    logger.error('PoD upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});


// GET /api/orders/history
router.get('/history', authenticate, userLimiter, requirePolicy('order:view-history'), async (req, res) => {
  const { cursor } = req.query;

  if (cursor !== undefined && (!Number.isInteger(Number(cursor)) || Number(cursor) < 1)) {
    return res.status(400).json({ error: 'Invalid cursor parameter. Must be a valid positive integer.' });
  }

  const page = cursor ? parseInt(cursor, 10) : (parseInt(req.query.page, 10) || 1);
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    return res.json(result);
  } catch (err) {
    logger.error('Order history fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

// GET /api/orders/my/active
router.get('/my/active', authenticate, userLimiter, requirePolicy('order:view-active'), async (req, res) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    return res.json(orders);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Active orders fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch active orders.' });
  }
});

// GET /api/orders/my/history
router.get('/my/history', authenticate, userLimiter, requirePolicy('order:view-history'), async (req, res) => {
  const { cursor } = req.query;

  if (cursor !== undefined && (!Number.isInteger(Number(cursor)) || Number(cursor) < 1)) {
    return res.status(400).json({ error: 'Invalid cursor parameter. Must be a valid positive integer.' });
  }

  const page = cursor ? parseInt(cursor, 10) : (parseInt(req.query.page, 10) || 1);
  const limit = parseInt(req.query.limit, 10) || 20;

  try {
    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    return res.json(result);
  } catch (err) {
    logger.error('Order history fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order history.' });
  }
});

// GET /api/orders/:id/timeline
router.get('/:id/timeline', authenticate, userLimiter, requirePolicy('order:view-timeline', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const timeline = await orderLifecycleService.getOrderTimeline(req.params.id, req.user.id);
    return res.json(timeline);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order timeline fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order timeline.' });
  }
});

// GET /api/orders/:id
router.get('/:id', authenticate, userLimiter, requirePolicy('order:view', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const detail = await orderLifecycleService.getOrderDetail(req.params.id, req.user.id);
    return res.json(detail);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order detail fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch order.' });
  }
});

// GET /api/orders/:id/bids - customer views bids on their order
router.get('/:id/bids', authenticate, userLimiter, requirePolicy('order:view', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const bids = await orderLifecycleService.getBidsForOrder(req.params.id, req.user.id);
    return res.json({ bids });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order bids fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch bids.' });
  }
});

// POST /api/orders/:id/bids/:bidId/accept - customer accepts a bid
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requirePolicy('order:view', async (req) => {
  const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id');
  return { order };
}), validateParams(paramIdSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.acceptBid(req.params.id, req.params.bidId, req.user.id);
    return res.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Bid acceptance error:', err);
    return res.status(500).json({ error: 'Failed to accept bid.' });
  }
});

// POST /api/orders/:id/ratings - customer submits rating for a driver
router.post('/:id/ratings', authenticate, userLimiter, validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
  try {
    const { stars, comment } = req.body;
    const result = await orderLifecycleService.submitRating(req.params.id, req.user.id, stars, comment, createUserClient(req.token));
    return res.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Rating submission error:', err);
    return res.status(500).json({ error: 'Failed to submit rating.' });
  }
});

// POST /api/orders/:id/bids - driver submits bid on a load offer
router.post('/:id/bids', authenticate, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const { bid_amount } = req.body;
    const result = await orderLifecycleService.submitBid(req.params.id, req.user.id, bid_amount);
    return res.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Bid submission error:', err);
    return res.status(500).json({ error: 'Failed to submit bid.' });
  }
});

// GET /api/orders/load-offers/en-route - find en-route load opportunities for active driver
router.get('/load-offers/en-route', authenticate, requireRole(['driver']), async (req, res) => {
  try {
    const { currentLat, currentLng, maxDetourKm } = req.query;
    if (!currentLat || !currentLng) {
      return res.status(400).json({ error: 'currentLat and currentLng query parameters are required.' });
    }

    const { data: offers } = await supabase
      .from('load_offers')
      .select('id, pickup_lat, pickup_lng, drop_lat, drop_lng, weight, dimensions, pickup_deadline, payment_inr, freight_value, status')
      .eq('status', 'available');

    if (!offers || offers.length === 0) {
      return res.json({ recommendations: [], mlUsed: false });
    }

    const result = await matchEnRouteLoads({
      currentLat: Number(currentLat),
      currentLng: Number(currentLng),
      offers,
      maxDetourKm: maxDetourKm ? Number(maxDetourKm) : 50,
    });

    return res.json(result);
  } catch (err) {
    logger.error('En-route loads error:', err);
    return res.status(500).json({ error: 'Failed to fetch en-route load offers.' });
  }
});

export default router;
