import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';

import { bidLimiter, userLimiter, safeIpKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { redisClient, mongoDb, supabase } from '../config/db.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { z } from 'zod';
import {
  createOrderSchema,
  submitBidSchema,
  submitRatingSchema,
  paramIdSchema,
  acceptBidParamsSchema,
  updateMilestoneSchema,
  verifyDeliverySchema,
  predictDemandSchema,
  changeDropSchema,
  cancelOrderSchema,
} from '../validation/requestSchemas.js';
import { awardReputationPoints } from '../services/reputation.js';
import {
  escrowRefund,
  buildDepositTx,
  recordDepositTx,
  submitEscrowRefund,
  confirmEscrowRefund,
} from '../services/escrow.js';
import { BidAcceptanceService } from '../services/order/bidAcceptanceService.js';
import { DeliveryVerificationService } from '../services/order/deliveryVerificationService.js';
import { OrderTimelineService } from '../services/order/orderTimelineService.js';
import { createOrder } from '../services/order/orderCreationService.js';
import {
  sendDeliveryOtpNotification,
  storeDeliveryOtp,
  getActiveDeliveryOtp,
  verifyDeliveryOtp,
  expireDeliveryOtps
} from '../services/notificationService.js';
import { predictDemand, predictPrice } from '../services/ml.js';
import { DomainError } from '../services/order/domainError.js';
import { OrderValidationService } from '../services/order/orderValidationService.js';
import { OrderMilestoneService } from '../services/order/orderMilestoneService.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import logger from '../middleware/logger.js';
import { OrderLifecycleService } from '../services/order/orderLifecycleService.js';
import { getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';

const router = express.Router();
const orderRepository = new OrderRepository(supabase);

const orderValidationService = new OrderValidationService({ supabase, logger, orderRepository });
const orderMilestoneService = new OrderMilestoneService({ orderValidationService, orderRepository });

const bidAcceptanceService = new BidAcceptanceService({
  supabase,
  logger,
  notificationDispatcher: sendDeliveryOtpNotification,
  buildDepositTxFn: buildDepositTx,
  recordDepositTxFn: recordDepositTx,
  escrowRefundFn: submitEscrowRefund,
});
const deliveryVerificationService = new DeliveryVerificationService(orderRepository);
const orderTimelineService = new OrderTimelineService({
  supabase,
  logger,
});

const orderLifecycleService = new OrderLifecycleService({
  orderRepository,
  orderTimelineService,
  bidAcceptanceService,
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

const predictDemandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => req.user?.id || 'unauthenticated',
  store: createStore('rl:predict-demand:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demand prediction requests. Please try again later.' },
});

const telemetryLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 30,
  keyGenerator: (req) => {
    if (!req.user || !req.user.id) {
      return req.ip ? safeIpKeyGenerator(req) : 'unknown-ip';
    }
    return req.user.id;
  },
  store: createStore('rl:telemetry:'),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many telemetry requests. Please try again later.' },
});

const resendOtpLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:resend-otp:'),
  message: { error: 'Too many OTP resend requests. Please try again later.' },
});

const changeDropLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || 'unknown',
  store: createStore('rl:change-drop:'),
  message: { error: 'Too many drop change requests. Please try again later.' },
});

// ============================================================================
// 1. CREATE AN ORDER (CUSTOMER)
// ============================================================================
router.post('/', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateBody(createOrderSchema), async (req, res) => {
  try {
    const result = await createOrder({
      orderData: req.body,
      userId: req.user.id,
      user: req.user,
    });
    return res.status(201).json(result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order creation exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
// ============================================================================
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), async (req, res) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch active orders:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH LOAD OFFERS (MARKETPLACE)
// ============================================================================
router.get('/load-offers', authenticate, userLimiter, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const { data: offers, error } = await orderRepository.findLoadOffers(
      { is_en_route: false },
      { pagination: { page, limit } }
    );

    if (error) return res.status(500).json({ error: 'Failed to fetch load offers.', details: error.message });
    res.json(offers);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch load offers:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. FETCH EN-ROUTE LOADS (MARKETPLACE)
// ============================================================================
router.get('/load-offers/en-route', authenticate, userLimiter, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const { data: offers, error } = await orderRepository.findLoadOffers(
      { is_en_route: true },
      { pagination: { page, limit } }
    );

    if (error) return res.status(500).json({ error: 'Failed to fetch en-route loads.', details: error.message });
    res.json(offers);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch en-route loads:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. FETCH MY ORDER HISTORY (CUSTOMER)
// ============================================================================
router.get('/history', authenticate, userLimiter, requireRole(['customer']), async (req, res) => {
  try {
    const pageParam = req.query.page ?? '1';
    const limitParam = req.query.limit ?? '10';
    const page = typeof pageParam === 'string' ? Number(pageParam) : NaN;
    const limit = typeof limitParam === 'string' ? Number(limitParam) : NaN;

    if (!Number.isInteger(page) || page < 1) {
      return res.status(400).json({ error: 'page must be greater than or equal to 1' });
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return res.status(400).json({ error: 'limit must be between 1 and 100' });
    }

    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    res.json(result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch order history:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, '*');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertOrderAccess(order, req.user.id);

    const responseOrder = { ...order };
    const timeline = await orderTimelineService.getOrderTimeline(order.order_display_id);

    let driverProfile = null;
    if (order.driver_id) {
      const [profileResult, detailsResult] = await Promise.all([
        orderRepository.findProfile(order.driver_id, 'full_name, phone, avatar_url'),
        orderRepository.findDriverDetail(order.driver_id),
      ]);
      const profile = profileResult.data;
      const details = detailsResult.data;

      if (profile && details) {
        driverProfile = { name: profile.full_name, phone: profile.phone, avatar: profile.avatar_url, rating: details.rating, trips: details.total_trips };
      }
    }

    res.json({ order: responseOrder, timeline: timeline || [], driver: driverProfile });
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch order details:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 7. FETCH ORDER TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id/timeline', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'customer_id, driver_id, order_display_id');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertOrderAccess(order, req.user.id);

    try {
      const timeline = await orderTimelineService.getOrderTimeline(order.order_display_id);
      res.json(timeline);
    } catch (timelineErr) {
      if (timelineErr instanceof DomainError) {
        return res.status(timelineErr.status).json(timelineErr.payload);
      }
      return res.status(500).json({ error: 'Failed to fetch timeline.' });
    }
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch order timeline:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. SUBMIT BID FOR LOAD OFFER (DRIVER)
// ============================================================================
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const loadOfferId = req.params.id;
    const { bid_amount } = req.body;

    const offer = await orderValidationService.assertLoadOfferAvailable(loadOfferId);
    orderValidationService.assertNotOwnLoad(offer.customer_id, req.user.id);
    await orderValidationService.assertTruckAssigned(req.user.id);
    await orderValidationService.assertNoDuplicateBid(loadOfferId, req.user.id);

    const { data: bid, error: bidErr } = await orderRepository.createBid({ load_id: loadOfferId, driver_id: req.user.id, bid_amount, status: 'pending' });
    if (bidErr) return res.status(500).json({ error: 'Failed to record bid.', details: bidErr.message });

    res.status(201).json({ message: 'Bid submitted successfully.', bid });
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to submit bid:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 9. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
// ============================================================================
router.post('/:id/ratings', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
  try {
    const { stars, comment } = req.body;
    const result = await orderLifecycleService.submitRating(req.params.id, req.user.id, stars, comment);
    return res.status(201).json(result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to submit rating:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 10. VIEW BIDS FOR AN ORDER (CUSTOMER)
// ============================================================================
router.get('/:id/bids', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'order_display_id, customer_id');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);

    const { data: offer } = await orderRepository.findLoadOfferByOrderDisplayId(order.order_display_id);
    if (!offer) return res.json([]);

    const { data: bids, error: bidErr } = await orderRepository.findBidsByLoad(offer.id, 'pending', { orderBy: 'bid_amount', ascending: true });
    if (bidErr) return res.status(500).json({ error: 'Query failed.', details: bidErr.message });
    if (!bids || bids.length === 0) return res.json([]);

    const driverIds = bids.map(b => b.driver_id);
    const [profilesRes, detailsRes] = await Promise.all([
      orderRepository.findProfilesByIds(driverIds, 'id, full_name, avatar_url, phone'),
      orderRepository.findDriverDetails(driverIds)
    ]);

    const profiles = profilesRes.data || [];
    const details  = detailsRes.data || [];
    const truckIds = details.map(d => d.truck_id).filter(Boolean);
    const trucksRes = truckIds.length > 0 ? await orderRepository.findTrucksByIds(truckIds) : { data: [] };
    const trucks = trucksRes.data || [];

    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
    const detailMap  = Object.fromEntries(details.map(d => [d.user_id, d]));
    const truckMap   = Object.fromEntries(trucks.map(t => [t.id, t]));

    const enrichedBids = bids.map(bid => {
      const profile = profileMap[bid.driver_id] || {};
      const detail  = detailMap[bid.driver_id]  || {};
      const truck   = detail.truck_id ? truckMap[detail.truck_id] : null;

      return {
        id: bid.id, bid_amount: bid.bid_amount, created_at: bid.created_at,
        driver: {
          id: bid.driver_id, name: profile.full_name || 'Anonymous Driver', avatar: profile.avatar_url, phone: profile.phone,
          rating: detail.rating || 0.00, trips: detail.total_trips || 0, completion_rate: detail.completion_rate || 100.00
        },
        truck
      };
    });

    res.json(enrichedBids);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch bids:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 10b. ACCEPT BID (CUSTOMER)
// ============================================================================
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(
  z.object({
    id: z.string(),
    bidId: z.string(),
  })
), async (req, res) => {
  try {
    const result = await bidAcceptanceService.acceptBid({
      orderId: req.params.id,
      bidId: req.params.bidId,
      customerId: req.user.id,
    });
    return res.status(result.status || 200).json(result.body || result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err, name: err.name, msg: err.message, stack: err.stack }, 'Accept bid exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 11. UPDATE MILESTONE (DRIVER)
// ============================================================================
router.put('/:id/milestones', authenticate, userLimiter, requireRole(['driver']), milestoneLimiter, validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;

  try {
    const result = await orderMilestoneService.updateMilestone({ orderId, milestone, driverId: req.user.id });
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    console.log('CATCH BLOCK HIT, err.name:', err.name, 'err.constructor.name:', err.constructor?.name, 'message:', err.message);
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Milestone update error:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
// ============================================================================
router.post('/:id/verify-delivery', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { otp } = req.body;
    const { escrowUpdateFailed } = await deliveryVerificationService.verifyDelivery({
      orderId,
      driverId: req.user.id,
      otp,
    });

    if (escrowUpdateFailed) {
      return res.status(202).json({
        message: 'Delivery verified successfully. Escrow payout requires reconciliation.',
        escrow_status: 'released',
        payment_released: true,
      });
    }

    res.json({ message: 'Delivery verified successfully! Payment released to driver.' });
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[verify-delivery] Exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 14. RESEND DELIVERY OTP (DRIVER)
// ============================================================================
router.post('/:id/resend-otp', authenticate, userLimiter, resendOtpLimiter, requireRole(['driver']), validateParams(paramIdSchema), async (req, res) => {
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
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[OrderRoutes] Resend OTP error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 15. CHANGE DROP (CUSTOMER)
// ============================================================================
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(changeDropSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.changeDrop(req.params.id, req.user.id, req.body);
    res.json(result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Change drop exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
// ============================================================================
router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.cancelOrder(req.params.id, req.user.id, req.body.reason);
    if (result.status && result.body) {
      return res.status(result.status).json(result.body);
    }
    if (result.reconciliation_required) {
      return res.status(202).json(result);
    }
    return res.json(result);
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Cancel order exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 17. CONFIRM ESCROW DEPOSIT (CUSTOMER)
// ============================================================================
router.post('/:id/confirm-deposit', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(
  z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') }),
), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { txHash } = req.body;

    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, order_display_id, customer_id, escrow_booking_id, escrow_status, deposit_tx_hash');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);

    // Pre-check: if already funded (crash recovery), return success idempotently
    if (order.escrow_status === 'funded') {
      return res.json({ message: 'Escrow already confirmed.', txHash: order.deposit_tx_hash });
    }

    const result = await orderLifecycleService.confirmDeposit(orderId, req.user.id, txHash);
    return res.json({ message: 'Escrow deposit confirmed', txHash: result.txHash || txHash });
  } catch (err) {
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('[confirm-deposit] Exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 18. PREDICT RIDE DEMAND (CUSTOMER OR DRIVER)
// ============================================================================
router.post('/predict-demand', authenticate, userLimiter, requireRole(['customer', 'driver']), predictDemandLimiter, validateBody(predictDemandSchema), async (req, res) => {
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
router.get('/:id/driver-location', authenticate, userLimiter, telemetryLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id, driver_id, status');
    orderValidationService.assertOrderFound(order);

    if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }
    if (req.user.role === 'driver' && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

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
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err }, 'Fetch driver location exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, customer_id, driver_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng');
    orderValidationService.assertOrderFound(order);

    if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }
    if (req.user.role === 'driver' && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

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
    if (err.name === 'DomainError' || err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err }, 'Fetch order route exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
