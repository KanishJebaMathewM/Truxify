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
import rateLimit from 'express-rate-limit';

import { bidLimiter, userLimiter, userKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { mongoDb, supabase, redisClient, createUserClient } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { requirePolicy } from '../middleware/requirePolicy.js';
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
import { expireDeliveryOtps } from '../services/notificationService.js';
import { DomainError } from '../services/order/domainError.js';
import { predictDemand, predictPrice } from '../services/ml.js';
import { requireIdempotency } from '../middleware/idempotency.js';
import { acquireLock, releaseLock } from '../lib/redisLock.js';
import logger from '../middleware/logger.js';
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
  escrowRefund,
} from '../core/container.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import { computeOrderPricing } from '../lib/pricing.js';

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
  keyGenerator: userKeyGenerator,
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
/**
 * @openapi
 * /api/orders:
 *   post:
 *     tags: [Orders]
 *     summary: Create a new order
 *     description: Creates a new order with pickup/drop locations and cargo details. Customer role required.
 *     security:
 *       - BearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateOrderRequest'
 *     responses:
 *       201:
 *         description: Order created
 *       400:
 *         description: Validation error
 */
router.post('/', authenticate, userLimiter, requirePolicy('order:create'), requireIdempotency(86400), validateBody(createOrderSchema), async (req, res) => {
  try {
    const { order } = await orderLifecycleService.createOrder(req.user.id, req.user.fullName || 'Customer', req.body);
    return res.status(201).json({ message: 'Order created successfully and broadcasted to loads board.', order });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error('Order creation exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/my/active:
 *   get:
 *     tags: [Orders]
 *     summary: Get customer's active orders
 *     description: Returns active orders for the authenticated customer.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Active orders
 */
router.get('/my/active', authenticate, userLimiter, requirePolicy('order:view-active'), async (req, res) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch active orders:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH LOAD OFFERS (MARKETPLACE)
// ============================================================================
/**
 * @openapi
 * /api/orders/load-offers:
 *   get:
 *     tags: [Orders]
 *     summary: Get order load offers
 *     description: Returns load offers related to orders for the authenticated user.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Load offers
 */
router.get('/load-offers', authenticate, userLimiter, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const { data: offers, error } = await orderRepository.findLoadOffers(
      { is_en_route: false },
      { pagination: { page, limit } }
    );

    if (error) return res.status(500).json({ error: 'Failed to fetch load offers.', details: error.message });

    const cacheKey = `load-offers:${page}:${limit}`;
    if (redisClient) {
      await redisClient.set(cacheKey, JSON.stringify(offers), 'EX', 120).catch(() => {});
    }

    res.json(offers);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch load offers:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. FETCH EN-ROUTE LOADS (MARKETPLACE)
// ============================================================================
/**
 * @openapi
 * /api/orders/load-offers/en-route:
 *   get:
 *     tags: [Orders]
 *     summary: Get en-route load offers
 *     description: Returns load offers along the driver's current route.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: En-route offers
 */
router.get('/load-offers/en-route', authenticate, userLimiter, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  try {
    const { data: offers, error } = await orderRepository.findLoadOffers(
      { is_en_route: true },
      { pagination: { page, limit } }
    );

    if (error) return res.status(500).json({ error: 'Failed to fetch en-route loads.', details: error.message });

    const cacheKey = `load-offers:en-route:${page}:${limit}`;
    if (redisClient) {
      await redisClient.set(cacheKey, JSON.stringify(offers), 'EX', 120).catch(() => {});
    }

    res.json(offers);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch en-route loads:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 5. FETCH MY ORDER HISTORY (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/history:
 *   get:
 *     tags: [Orders]
 *     summary: Get customer's order history
 *     description: Returns paginated order history for the authenticated customer.
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Order history
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/OrderListResponse'
 */
router.get('/history', authenticate, userLimiter, requirePolicy('order:view-history'), async (req, res) => {
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
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch order history:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 6. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}:
 *   get:
 *     tags: [Orders]
 *     summary: Get order details
 *     description: Returns details for a specific order by ID.
 *     security:
 *       - BearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Order ID (UUID or display ID)
 *     responses:
 *       200:
 *         description: Order details
 *       404:
 *         description: Order not found
 */
router.get('/:id', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, '*');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertOrderAccess(order, req.user);

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
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch order details:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 7. FETCH ORDER TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/timeline:
 *   get:
 *     tags: [Orders]
 *     summary: Get order timeline
 *     description: Returns the event timeline for a specific order.
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
 *         description: Order timeline events
 */
router.get('/:id/timeline', authenticate, userLimiter, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'customer_id, driver_id, order_display_id');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertOrderAccess(order, req.user);

    const timeline = await orderTimelineService.getOrderTimeline(order.order_display_id);
    res.json(timeline);
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch timeline:", err.message);
    return res.status(500).json({ error: 'Failed to fetch timeline.' });
  }
});

// ============================================================================
// 8. SUBMIT BID FOR LOAD OFFER (DRIVER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a bid on an order
 *     description: Allows a driver to place a bid on an order. Rate-limited per driver.
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
 *       429:
 *         description: Rate limited
 */
router.post('/:id/bids', authenticate, userLimiter, requirePolicy('bid:submit'), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  try {
    const loadOfferId = req.params.id;
    const { bid_amount } = req.body;
    const offer = await orderValidationService.assertLoadOfferAvailable(loadOfferId);
    orderValidationService.assertNotOwnLoad(offer.customer_id, req.user.id);
    await orderValidationService.assertTruckAssigned(req.user.id);
    await orderValidationService.assertHosCompliant(req.user.id);
    await orderValidationService.assertNoDuplicateBid(loadOfferId, req.user.id);

    const { data: bid, error: bidErr } = await orderRepository.createBid({ load_id: loadOfferId, driver_id: req.user.id, bid_amount, status: 'pending' });
    if (bidErr) return res.status(500).json({ error: 'Failed to record bid.', details: bidErr.message });

    res.status(201).json({ message: 'Bid submitted successfully.', bid });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to submit bid:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 9. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/ratings:
 *   post:
 *     tags: [Orders]
 *     summary: Submit a rating for an order
 *     description: Allows a customer to submit a rating and review for a completed order.
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
 *             $ref: '#/components/schemas/SubmitRatingRequest'
 *     responses:
 *       201:
 *         description: Rating submitted
 *       400:
 *         description: Validation error
 */
router.post('/:id/ratings', authenticate, userLimiter, requirePolicy('order:submit-rating'), validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { stars, comment } = req.body;

    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, order_display_id, customer_id, driver_id, status');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);
    orderValidationService.assertRatingDeliverable(order);
    await orderValidationService.assertNoDuplicateRating(order.order_display_id, req.user.id);

    const { data: ratingData, error: rpcErr } = await orderRepository.executeRpc('submit_rating_tx', {
      p_order_display_id: order.order_display_id,
      p_customer_id: req.user.id,
      p_driver_id: order.driver_id,
      p_stars: stars,
      p_comment: comment,
    }, req.token ? createUserClient(req.token) : undefined);

    if (rpcErr) {
      return res.status(500).json({ error: 'Failed to submit rating.', details: rpcErr.message });
    }

    const { data: driverDetails } = await orderRepository.findDriverWallet(order.driver_id);
    const polygonAddress = driverDetails?.polygon_wallet_address ?? null;

    if (polygonAddress) {
      void awardReputationPoints(polygonAddress, stars).catch((repErr) => {
        logger.error('[reputation] On-chain reputation update failed:', repErr.message);
        orderRepository.insertReputationFailure({
          driver_wallet: polygonAddress,
          stars,
          failed_at: new Date().toISOString(),
          retry_count: 0,
          last_error: repErr.message,
        }).catch((dbErr) => logger.error('[reputation] Failed to log failure:', dbErr.message));
      });
    } else {
      logger.warn(`[reputation] Driver ${order.driver_id} has no polygon_wallet_address — skipping on-chain update.`);
    }

    return res.status(201).json({
      message: 'Rating submitted successfully.',
      rating: {
        order_display_id: order.order_display_id,
        customer_id: req.user.id,
        driver_id: order.driver_id,
        stars,
        comment,
      },
    });
  } catch (err) {
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to submit rating:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 10. VIEW BIDS FOR AN ORDER (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids:
 *   get:
 *     tags: [Orders]
 *     summary: List bids on an order
 *     description: Returns all bids for a specific order. Customer role required.
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
 *         description: Array of bids
 */
router.get('/:id/bids', authenticate, userLimiter, requirePolicy('order:view-bids'), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'order_display_id, customer_id');
    if (!order) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });

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
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error("[orderRoutes] Failed to fetch bids:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 11. ACCEPT BID (CUSTOMER)
// ============================================================================
/**
 * @openapi
 * /api/orders/{id}/bids/{bidId}/accept:
 *   post:
 *     tags: [Orders]
 *     summary: Accept a bid on an order
 *     description: Accepts a driver's bid for an order. Handles escrow deposit, reputation award, and bid acceptance with idempotency.
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
 *         description: Bid accepted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AcceptBidResponse'
 *       400:
 *         description: Bid acceptance failed
 *       409:
 *         description: Bid already accepted or conflict
 */

router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requirePolicy('order:accept-bid'), requireIdempotency(86400), validateParams(acceptBidParamsSchema), async (req, res) => {
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
router.put('/:id/milestones', authenticate, userLimiter, requirePolicy('milestone:update'), milestoneLimiter, validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;

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
    logger.error("[orderRoutes] Milestone update error:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
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
router.post('/:id/verify-delivery', authenticate, userLimiter, requirePolicy('delivery:verify'), verifyDeliveryLimiter, requireIdempotency(86400), validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
  try {
    const { escrowUpdateFailed } = await orderLifecycleService.verifyDeliveryFn(req.params.id, req.user.id, req.body.otp);

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
router.put('/:id/change-drop', authenticate, userLimiter, changeDropLimiter, requirePolicy('order:change-drop'), validateParams(paramIdSchema), validateBody(changeDropSchema), async (req, res) => {
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
        pickupLat:  Number(order.pickup_lat),
        pickupLng:  Number(order.pickup_lng),
        dropLat:    Number(drop_lat),
        dropLng:    Number(drop_lng),
        weightTonnes: Number(order.weight_tonnes),
        roadDistanceKm: routeEstimate?.distanceKm,
        isFragile:   Boolean(order.is_fragile),
        isStackable: Boolean(order.is_stackable),
      });
    } catch (pricingErr) {
      logger.error('Pricing computation error for change-drop:', pricingErr.message);
      return res.status(400).json({ error: 'Unable to compute new pricing for the requested drop.', details: pricingErr.message });
    }

    const updates = {
      drop_address,
      drop_lat: Number(drop_lat),
      drop_lng: Number(drop_lng),
      base_freight: pricing.baseFreight,
      toll_estimate: pricing.tollEstimate,
      platform_fee: pricing.platformFee,
      total_amount: pricing.totalAmount,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrder(order.id, updates);
    if (updateErr) return res.status(500).json({ error: 'Failed to update order.', details: updateErr.message });

    const { error: offerUpdateErr } = await orderRepository.updateLoadOffer(order.order_display_id, {
      drop_address,
      drop_lat: Number(drop_lat),
      drop_lng: Number(drop_lng),
      route_label: `${(order.pickup_address || '').split(',')[0]} → ${drop_address.split(',')[0]}`,
      freight_value: pricing.totalAmount,
      fuel_cost: pricing.fuelCost,
      toll_cost: pricing.tollEstimate,
      net_profit: pricing.netProfit,
      extra_distance_km: pricing.distanceKm,
    });

    if (offerUpdateErr) {
      logger.error('Load offer update failed for change-drop:', offerUpdateErr.message);
    }

    try {
      await orderRepository.insertTimelineEntry({ order_display_id: order.order_display_id, milestone: 'Drop Changed', milestone_time: new Date().toISOString(), completed: true, sort_order: 25 });
    } catch (timelineErr) {
      logger.warn('Failed to update timeline for change-drop:', timelineErr.message);
    }
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
router.post('/:id/cancel', authenticate, userLimiter, requirePolicy('order:cancel'), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), async (req, res) => {
  try {
    const result = await orderLifecycleService.cancelOrder(req.params.id, req.user.id, req.body.reason);
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
router.post('/:id/confirm-deposit', authenticate, userLimiter, requirePolicy('order:confirm-deposit'), validateParams(paramIdSchema), validateBody(
  z.object({ txHash: z.string().regex(/^0x([A-Fa-f0-9]{64})$/, 'Invalid transaction hash') }),
), async (req, res) => {
  const orderId = req.params.id;
  const { txHash } = req.body;

  const lockKey = `deposit_lock:${orderId}`;
  let lockValue = null;
  lockValue = await acquireLock(lockKey, 120000);
  if (!lockValue) {
    return res.status(409).json({ error: 'Another deposit confirmation is in progress for this order. Please try again.' });
  }

  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, 'id, order_display_id, customer_id, escrow_booking_id, escrow_status');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);
    orderValidationService.assertEscrowState(order, ['funding'], 'Order is not in funding state');
    if (order.status === 'cancelled') return res.status(409).json({ error: 'Order is already cancelled. Cannot confirm deposit.' });

    const { data: customerProfile } = await orderRepository.findCustomerWallet(req.user.id);
    const customerWallet = customerProfile?.polygon_wallet_address ?? null;
    const bookingId = order.escrow_booking_id || getEscrowBookingId(order.order_display_id);
    const result = await recordDepositTx(bookingId, txHash, customerWallet);

    if (result.error) {
      if (result.alreadyFunded) {
        const { error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
          escrow_status: 'funded',
          deposit_tx_hash: result.txHash,
          escrow_deposited_at: new Date().toISOString(),
        }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');

        if (!updateErr) {
          return res.json({ message: 'Escrow deposit confirmed (recovered).', txHash: result.txHash });
        }
        return res.status(202).json({ message: 'Escrow deposit confirmed on-chain. Database sync pending.', txHash: result.txHash });
      }
      return res.status(422).json({ error: result.error });
    }

    const { error: updateErr } = await orderRepository.updateOrderWithFilter(orderId, {
      escrow_status: 'funded',
      deposit_tx_hash: result.txHash,
      escrow_deposited_at: new Date().toISOString(),
    }, [{ op: 'eq', column: 'escrow_status', value: 'funding' }], 'id');

    if (updateErr) {
      logger.error('[confirm-deposit] DB update failed:', updateErr.message);
      return res.status(500).json({ error: 'Database update failed after deposit confirmation. Please contact support.' });
    }

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
router.get('/:id/driver-location', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-driver-location'), validateParams(paramIdSchema), async (req, res) => {
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
router.get('/:id/route', authenticate, userLimiter, telemetryLimiter, requirePolicy('order:view-route'), validateParams(paramIdSchema), async (req, res) => {
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
    if (err instanceof DomainError) {
      return res.status(err.status).json(err.payload);
    }
    logger.error({ err }, 'Fetch order route exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

// POST /api/orders/:id/pod
router.post('/:id/pod', authenticate, requireRole(['driver']), upload.fields([{ name: 'signature', maxCount: 1 }, { name: 'photo', maxCount: 1 }]), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { data: order, error } = await orderRepository.findOrderById(orderId);
    
    if (error || !order) return res.status(404).json({ error: 'Order not found' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: Not your order' });

    let signatureUrl = order.pod_signature_url;
    let photoUrl = order.pod_photo_url;
    const files = req.files || {};
    
    if (files.signature && files.signature[0]) {
      const file = files.signature[0];
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const path = `${req.user.id}/pod_sig_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('driver-documents').upload(path, file.buffer, { contentType: file.mimetype });
      if (!upErr) signatureUrl = path;
    }

    if (files.photo && files.photo[0]) {
      const file = files.photo[0];
      const ext = file.mimetype === 'image/png' ? 'png' : 'jpg';
      const path = `${req.user.id}/pod_photo_${orderId}_${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from('driver-documents').upload(path, file.buffer, { contentType: file.mimetype });
      if (!upErr) photoUrl = path;
    }

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrder(orderId, {
      pod_signature_url: signatureUrl,
      pod_photo_url: photoUrl,
      updated_at: new Date().toISOString()
    });

    if (updateErr) {
      logger.error('Failed to update order with PoD:', updateErr.message);
      return res.status(500).json({ error: 'Failed to update order with PoD URLs' });
    }

    return res.json({ message: 'Proof of Delivery uploaded successfully', order: updatedOrder });
  } catch (err) {
    logger.error('PoD upload error:', err.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
