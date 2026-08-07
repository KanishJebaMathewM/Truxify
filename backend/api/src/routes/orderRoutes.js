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

import { bidLimiter, userLimiter, userKeyGenerator, podUploadLimiter, createStore, verifyDeliveryLimiter, resendOtpLimiter, changeDropLimiter, predictDemandLimiter, telemetryLimiter } from '../middleware/rateLimiter.js';
import { mongoDb, supabase, redisClient, createUserClient, supabaseAdmin } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
import { validateDocumentBuffer } from '../lib/documentValidation.js';
import { scanDocument } from '../lib/malwareScanner.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { z } from 'zod';
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
  submitEscrowRefund,
  confirmEscrowRefund,
} from '../core/container.js';
import { getEscrowBookingId, paisaToMaticWei } from '../services/escrow.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';

const router = express.Router();

router.post('/api/deliveries/:id/geofence-confirm', async (req, res) => {
  const { driver_lat, driver_lng, geofence_radius_m } = req.body;

  const lat = parseFloat(driver_lat);
  const lng = parseFloat(driver_lng);

  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return res.status(400).json({ error: 'Invalid driver_lat or driver_lng' });
  }

  let geofenceRadiusM;
  if (geofence_radius_m !== undefined) {
    geofenceRadiusM = parseFloat(geofence_radius_m);
    if (!Number.isFinite(geofenceRadiusM) || geofenceRadiusM <= 0) {
      return res.status(400).json({ error: 'Invalid geofence_radius_m' });
    }
  }

  try {
    // Verify the order exists and the requesting driver is assigned to it
    const order = await orderValidationService.findOrderByIdOrDisplayId(
      req.params.id,
      'id, driver_id, customer_id',
    );
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertDriverAssignment(order, req.user.id);

    logger.info(
      {
        event: 'GEOFENCE_CONFIRM_ATTEMPT',
        orderId: req.params.id,
        driverId: req.user.id,
        lat,
        lng,
      },
      'Driver geofence confirm attempt',
    );

    const result = await orderLifecycleService.deliveryVerification.geofenceAutoConfirm({
      orderId: req.params.id,
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
    logger.error('[geofence-confirm] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13c. DRIVER OTP CONFIRM ALIAS — POST /api/deliveries/:id/confirm-otp
// ============================================================================
/**
 * Friendly alias of /:id/verify-delivery for the driver app.
 * Accepts the same body { otp } and delegates to the same pipeline.
 * Mounted on the *orders* router but exposed as /api/deliveries/:id/confirm-otp
 * via the separate deliveryRoutes mount in index.js (see below).
 *
 * This keeps the driver app URL surface clean while reusing identical logic.
 */
router.post(
  '/:id/confirm-otp',
  authenticate,
  userLimiter,
  requirePolicy('delivery:verify'),
  auditLog({ action: 'delivery:verify', resourceType: 'delivery_verification' }),
  verifyDeliveryLimiter,
  requireIdempotency(86400),
  validateParams(paramIdSchema),
  validateBody(verifyDeliverySchema),
  async (req, res) => {
    try {
      const order = await orderValidationService.findOrderByIdOrDisplayId(
        req.params.id,
        'id, driver_id, customer_id'
      );
      orderValidationService.assertOrderFound(order);
      orderValidationService.assertDriverAssignment(order, req.user.id);

      logger.info({
        event: 'CONFIRM_OTP_ATTEMPT',
        orderId: req.params.id,
        driverId: req.user.id,
      }, 'Driver OTP confirm attempt');

      const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(
        req.params.id,
        req.user.id,
        req.body.otp,
        req.token ? createUserClient(req.token) : undefined
      );

      // Fetch the released amount to include in the response
      const orderForAmount = await orderValidationService.findOrderByIdOrDisplayId(
        req.params.id,
        'total_amount, order_display_id'
      );
      const amountInr = orderForAmount?.total_amount
        ? (orderForAmount.total_amount / 100).toFixed(0)
        : null;

      if (escrowUpdateFailed) {
        logger.warn(
          '[confirm-otp] Escrow payout requires reconciliation.',
          { orderId: req.params.id, driverId: req.user.id }
        );
        return res.status(202).json({
          message: 'Delivery confirmed. Payout is pending reconciliation.',
          payment_released: false,
          escrow_status: 'released',
          reconciliation_required: true,
          amount_inr: amountInr,
        });
      }

      return res.json({
        message: 'Delivery confirmed! Payment released to driver.',
        payment_released: true,
        escrow_status: 'released',
        amount_inr: amountInr,
        order_display_id: orderForAmount?.order_display_id,
      });
    } catch (err) {
      if (err instanceof DomainError) {
        return res.status(err.status).json(err.payload);
      }
      logger.error('[confirm-otp] Exception:', err.message);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }
);

// ============================================================================
// 14. RESEND DELIVERY OTP (DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/resend-otp:
 *   post:
 *     tags: [Orders]
 *     summary: Resend delivery OTP
 *     description: Resends the delivery verification OTP to the customer. Rate-limited.
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
 *         description: OTP resent
 *       429:
 *         description: Rate limited
 */
router.post('/:id/resend-otp', authenticate, userLimiter, resendOtpLimiter, requirePolicy('delivery:resend-otp'), validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, order_display_id, driver_id, customer_id, status');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertDriverAssignment(order, req.user.id);

    const { expiresInMinutes } = await deliveryVerificationService.resendDeliveryOtp({
      orderId,
      customerId: order.customer_id,
      orderDisplayId: order.order_display_id,
      orderStatus: order.status,
    });

    res.json({ message: 'New delivery OTP sent.', expiresInMinutes });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[OrderRoutes] Resend OTP error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 15. CHANGE DROP (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/change-drop:
 *   put:
 *     tags: [Orders]
 *     summary: Change drop location
 *     description: Updates the drop location for an active order. Customer role required. Rate-limited.
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
 *             $ref: '#/components/schemas/ChangeDropRequest'
 *     responses:
 *       200:
 *         description: Drop location updated
 *       429:
 *         description: Rate limited
 */
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requirePolicy('order:change-drop'), auditLog({ action: 'order:change-drop', resourceType: 'order' }), validateParams(paramIdSchema), validateBody(changeDropSchema), async (req, res) => {
  const { id: orderId } = req.params;
  const { drop_address, drop_lat, drop_lng } = req.body;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, '*');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);
    orderValidationService.assertChangeDropAllowed(order);
    orderValidationService.assertHasWeight(order);

    let pricing;
    try {
      const routeEstimate = await getRouteEstimate({
        pickupLat: Number(order.pickup_lat),
        pickupLng: Number(order.pickup_lng),
        dropLat: Number(drop_lat),
        dropLng: Number(drop_lng),
      });

      pricing = computeOrderPricing({
        pickupLat: Number(order.pickup_lat),
        pickupLng: Number(order.pickup_lng),
        dropLat: Number(drop_lat),
        dropLng: Number(drop_lng),
        weightTonnes: Number(order.weight_tonnes),
        roadDistanceKm: routeEstimate?.distanceKm,
        isFragile: Boolean(order.is_fragile),
        isStackable: Boolean(order.is_stackable),
      });
    } catch (pricingErr) {
      logger.error('Pricing computation error for change-drop:', pricingErr.message);
      return res.status(400).json({ error: 'Unable to compute new pricing for the requested drop.', details: pricingErr.message });
    }

    // Rebalance the escrow booking alongside the re-priced total so the
    // displayed price, the on-chain payout, and any refund all stay in sync.
    // escrow_amount_wei is the authoritative payout figure (verified against
    // at deposit time and read on release), so it must track total_amount.
    const newAmountWei = BigInt(paisaToMaticWei(pricing.totalAmount));

    const updates = {
      drop_address,
      drop_lat: Number(drop_lat),
      drop_lng: Number(drop_lng),
      base_freight: pricing.baseFreight,
      toll_estimate: pricing.tollEstimate,
      platform_fee: pricing.platformFee,
      total_amount: pricing.totalAmount,
      escrow_amount_wei: newAmountWei.toString(),
      updated_at: new Date().toISOString(),
    };

    const offerUpdates = {
      drop_address,
      drop_lat: Number(drop_lat),
      drop_lng: Number(drop_lng),
      route_label: `${(order.pickup_address || '').split(',')[0]} → ${drop_address.split(',')[0]}`,
      freight_value: pricing.totalAmount,
      fuel_cost: pricing.fuelCost,
      toll_cost: pricing.tollEstimate,
      net_profit: pricing.netProfit,
      extra_distance_km: pricing.distanceKm,
    };

    const { data: updatedOrder, error: updateErr } = await orderRepository.executeRpc('update_order_and_load_offer', {
      p_order_id: order.id,
      p_order_display_id: order.order_display_id,
      p_order_updates: updates,
      p_offer_updates: offerUpdates
    }, supabaseAdmin);

    if (updateErr) {
      logger.error('Order and load offer atomic update failed for change-drop:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update order atomically.', details: updateErr.message });
    }

    // Single canonical writer for the drop-change event. OrderTimelineService
    // is the only path that inserts into order_timeline for this milestone.
    await orderTimelineService.insertDropChangedEvent(order.order_display_id);

    await expireDeliveryOtps(order.id);

    return res.json({
      message: 'Drop location updated successfully.',
      pricing: {
        base_freight: pricing.baseFreight,
        toll_estimate: pricing.tollEstimate,
        platform_fee: pricing.platformFee,
        total_amount: pricing.totalAmount,
      },
      order: updatedOrder,
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Change drop exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/cancel:
 *   post:
 *     tags: [Orders]
 *     summary: Cancel an order
 *     description: Cancels an order with a required reason. Customer role required.
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
 *             $ref: '#/components/schemas/CancelOrderRequest'
 *     responses:
 *       200:
 *         description: Order cancelled
 *       400:
 *         description: Validation error
 */
router.post('/:id/cancel', authenticate, userLimiter, requirePolicy('order:cancel'), auditLog({ action: 'order:cancel', resourceType: 'order' }), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.cancelOrder(
      req.params.id,
      req.user.id,
      req.body.reason,
      req.token ? createUserClient(req.token) : undefined
    );
    return res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Cancel order exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

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
router.post('/:id/confirm-deposit', authenticate, userLimiter, requirePolicy('order:confirm-deposit'), auditLog({ action: 'order:confirm-deposit', resourceType: 'order' }), validateParams(paramIdSchema), validateBody(
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
        const refundConfirmed = !!(refundResult && !refundResult.error && refundResult.txHash);

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

        // Refund confirmed — safe to release the escrow booking reference.
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
        'bid_accepted',
        { orderId, orderDisplayId: pending.order_display_id }
      ).catch((err) => logger.error(`[FCM] Failed to notify driver of bid acceptance: ${err.message}`));
    };

    const result = await recordDepositTx(
      bookingId,
      txHash,
      customerWallet,
      order.escrow_driver_wallet ?? null,
      order.escrow_amount_wei ?? null
    );

    if (result.alreadyFunded) {
      const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
        escrow_status: 'funded',
        deposit_tx_hash: result.txHash,
        escrow_deposited_at: new Date().toISOString(),
      }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');

      if (!updateErr && updatedData) {
        await finalizeAcceptance();
        return res.json({ message: 'Escrow deposit confirmed (recovered).', txHash: result.txHash });
      }
      return res.status(202).json({ message: 'Escrow deposit confirmed on-chain. Database sync pending.', txHash: result.txHash });
    }

    if (result.error) {
      return res.status(422).json({ error: result.error });
    }

    const { data: updatedData, error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
      escrow_status: 'funded',
      deposit_tx_hash: result.txHash,
      escrow_deposited_at: new Date().toISOString(),
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
    invalidateBookingCaches().catch(err => logger.error({ err }, 'Failed to invalidate cache on confirm deposit'));
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
// 18. PREDICT RIDE DEMAND (CUSTOMER OR DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/predict-demand:
 *   post:
 *     tags: [Orders]
 *     summary: Predict demand/price
 *     description: Uses ML to predict demand or price for a given route. Rate-limited to 10 requests per minute.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/PredictDemandRequest'
 *     responses:
 *       200:
 *         description: Prediction result
 *       429:
 *         description: Rate limited
 */
router.post('/predict-demand', authenticate, userLimiter, requirePolicy('order:predict-demand'), predictDemandLimiter, validateBody(predictDemandSchema), async (req, res) => {
  try {
    const prediction = await predictDemand(req.body);
    return res.json(prediction);
  } catch (err) {
    logger.error('[ML integration] Demand prediction failed:', err.message);
    return res.status(502).json({
      error: 'Failed to fetch demand prediction from ML engine.',
      details: err.message,
    });
  }
});

// ============================================================================
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
  const { data: order } = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
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

// ============================================================================
// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
// ============================================================================

/**
 * @openapi
 * /api/orders/{id}/route:
 *   get:
 *     tags: [Orders]
 *     summary: Get order route
 *     description: Returns the computed route geometry and distance/duration for an order.
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
 *         description: Route data
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderRouteResponse'
 */
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-route', async (req) => {
  const { data: order } = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id');
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
router.post('/:id/pod', authenticate, requireRole(['driver']), podUploadLimiter, podUpload.fields([{ name: 'signature', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
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

module.exports = router;
