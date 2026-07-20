import express from 'express';
import rateLimit from 'express-rate-limit';

import { bidLimiter, userLimiter, userKeyGenerator, createStore } from '../middleware/rateLimiter.js';
import { mongoDb, supabase } from '../config/db.js';
import { authenticate } from '../middleware/auth.js';
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
router.post('/', authenticate, userLimiter, requirePolicy('order:create'), requireIdempotency(86400), validateBody(createOrderSchema), async (req, res) => {
  const {
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    goods_type, weight_tonnes,
    pickup_date, pickup_time,
    length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    payment_method_id, upi_id,
  } = req.body;

  if (pickup_address && pickup_address.length > 200) {
    return res.status(400).json({ error: 'pickup_address too long (max 200 chars)' });
  }
  if (drop_address && drop_address.length > 200) {
    return res.status(400).json({ error: 'drop_address too long (max 200 chars)' });
  }

  if (!pickup_address || pickup_lat == null || pickup_lng == null || !drop_address || drop_lat == null || drop_lng == null || !goods_type || weight_tonnes == null) {
    return res.status(400).json({ error: 'Missing required routing or cargo specification fields.' });
  }

  let pricing;
  try {
    const routeEstimate = await getRouteEstimate({
      pickupLat: Number(pickup_lat),
      pickupLng: Number(pickup_lng),
      dropLat: Number(drop_lat),
      dropLng: Number(drop_lng),
    });
    pricing = computeOrderPricing({
      pickupLat:  Number(pickup_lat),
      pickupLng:  Number(pickup_lng),
      dropLat:    Number(drop_lat),
      dropLng:    Number(drop_lng),
      weightTonnes: Number(weight_tonnes),
      roadDistanceKm: routeEstimate?.distanceKm,
      isFragile:   Boolean(is_fragile),
      isStackable: Boolean(is_stackable),
    });
  } catch (pricingErr) {
    logger.error('Pricing computation error:', pricingErr.message);
    return res.status(400).json({
      error: 'Unable to compute freight pricing for the given route/cargo.',
      details: pricingErr.message,
    });
  }

  let estimatedPrice = null;
  try {
    const mlResult = await predictPrice({
      distanceKm: pricing.distanceKm,
      cargoWeightKg: Number(weight_tonnes) * 1000,
      routeOrigin: pickup_address,
      routeDestination: drop_address,
    });
    estimatedPrice = mlResult.estimatedPricePaisa;
  } catch (mlErr) {
    logger.warn({ err: mlErr.message }, 'Price prediction unavailable, falling back to base pricing');
  }

  const MAX_ID_RETRIES = 3;
  let order = null;
  let orderErr = null;
  let orderDisplayId = null;

  try {
    for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
      orderDisplayId = generateOrderDisplayId();
      const result = await supabase
        .from('orders')
        .insert({
          order_display_id: orderDisplayId,
          customer_id: req.user.id,
          status: 'pending',
          pickup_address, pickup_lat, pickup_lng,
          drop_address, drop_lat, drop_lng,
          pickup_date, pickup_time,
          goods_type, weight_tonnes, length_ft, width_ft, height_ft,
          is_stackable, is_fragile, special_requirements,
          base_freight: pricing.baseFreight,
          toll_estimate: pricing.tollEstimate,
          platform_fee: pricing.platformFee,
          total_amount: pricing.totalAmount,
          estimated_price: estimatedPrice,
          payment_method_id, upi_id
        })
        .select('id, order_display_id, status, created_at')
        .single();

      order = result.data;
      orderErr = result.error;

      if (!orderErr || orderErr.code !== '23505') break;
      logger.warn(`[Orders] display ID collision on ${orderDisplayId}, retrying (attempt ${attempt + 1}/${MAX_ID_RETRIES})`);
    }

    if (orderErr) {
      logger.error('Order Insertion Error:', orderErr.message);
      return res.status(500).json({ error: 'Failed to create order record.', details: orderErr.message });
    }

    const milestones = [
      { order_display_id: orderDisplayId, milestone: 'Order Placed', milestone_time: new Date().toISOString(), completed: true, sort_order: 10 },
      { order_display_id: orderDisplayId, milestone: 'Truck Assigned', milestone_time: null, completed: false, sort_order: 20 },
      { order_display_id: orderDisplayId, milestone: 'En Route to Pickup', milestone_time: null, completed: false, sort_order: 30 },
      { order_display_id: orderDisplayId, milestone: 'Arrived at Pickup', milestone_time: null, completed: false, sort_order: 35 },
      { order_display_id: orderDisplayId, milestone: 'Goods Loaded', milestone_time: null, completed: false, sort_order: 40 },
      { order_display_id: orderDisplayId, milestone: 'In Transit', milestone_time: null, completed: false, sort_order: 50 },
      { order_display_id: orderDisplayId, milestone: 'Arriving', milestone_time: null, completed: false, sort_order: 55 },
      { order_display_id: orderDisplayId, milestone: 'Delivered', milestone_time: null, completed: false, sort_order: 60 }
    ];

    const { error: timelineErr } = await orderRepository.createTimeline(milestones);

    if (timelineErr) {
      logger.error('Timeline Insertion Error:', timelineErr.message);
      await orderRepository.deleteOrder(order.id);
      return res.status(500).json({ error: 'Failed to create order timeline.', details: timelineErr.message });
    }

    try {
      await orderTimelineService.createOrderTimeline(orderDisplayId);
    } catch (timelineErr) {
      await orderRepository.deleteOrder(order.id);
      if (timelineErr instanceof DomainError) {
        return res.status(timelineErr.status).json(timelineErr.payload);
      }
      return res.status(500).json({ error: 'Failed to create order timeline.', details: timelineErr.message });
    }

    const { error: offerErr } = await orderRepository.createLoadOffer({
        order_display_id: orderDisplayId,
        customer_id: req.user.id,
        customer_name: req.user.fullName || 'Customer',
        route_label: `${pickup_address.split(',')[0]} → ${drop_address.split(',')[0]}`,
        route_subtitle: `${weight_tonnes} tonnes • ${goods_type}`,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        goods_type,
        weight: `${weight_tonnes} tonnes`,
        freight_value: pricing.totalAmount,
        fuel_cost: pricing.fuelCost,
        toll_cost: pricing.tollEstimate,
        net_profit: pricing.netProfit,
        extra_distance_km: pricing.distanceKm,
        status: 'available'
      });

    if (offerErr) {
      logger.error('Load Offer Insertion Error:', offerErr.message);
      await orderRepository.deleteTimeline(orderDisplayId);
      await orderRepository.deleteOrder(order.id);
      return res.status(500).json({ error: 'Failed to create load offer.', details: offerErr.message });
    }

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
router.post('/:id/bids', authenticate, userLimiter, requirePolicy('bid:submit'), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
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
router.post('/:id/cancel', authenticate, userLimiter, requirePolicy('order:cancel'), requireIdempotency(86400), validateParams(paramIdSchema), validateBody(cancelOrderSchema), async (req, res) => {
  try {
    const orderId = req.params.id;
    const { reason } = req.body;
    const order = await orderValidationService.findOrderByIdOrDisplayId(orderId, '*');
    orderValidationService.assertOrderFound(order);
    orderValidationService.assertCustomerOwnership(order, req.user.id);
    await orderValidationService.assertDeliveryNotVerified(order.id);

    if (order.status === 'cancelled' && order.escrow_status === 'refunded') {
      return res.json({
        message: 'Order was already cancelled and refunded.',
        cancellation_fee: order.cancellation_fee ?? 0,
        order,
      });
    }

    const requiresRefund = ['funded', 'refund_pending', 'refund_failed'].includes(order.escrow_status);
    let workingOrder = order;

    if (requiresRefund && (order.status !== 'cancelled' || order.escrow_status !== 'refund_pending')) {
      const attemptAt = new Date().toISOString();
      const { data: pendingOrder, error: pendingErr } = await orderRepository.updateOrderWithFilter(
        order.id,
        {
          status: 'cancelled',
          cancellation_reason: reason ?? order.cancellation_reason,
          escrow_status: 'refund_pending',
          escrow_refund_error: null,
          escrow_refund_attempts: (order.escrow_refund_attempts ?? 0) + 1,
          escrow_refund_last_attempt_at: attemptAt,
          updated_at: attemptAt,
        },
        [
          { op: 'not', column: 'status', operator: 'in', value: '("delivered","payment_released","cancelled")' },
          { op: 'eq', column: 'escrow_status', value: order.escrow_status },
        ]
      );

      if (pendingErr) {
        if (pendingErr.code === 'PGRST116') {
          return res.status(409).json({ error: 'Order was already delivered, payment released, or cancelled. Cannot cancel.' });
        }
        return res.status(500).json({
          error: 'Failed to place the order into refund reconciliation.',
          details: pendingErr.message,
        });
      }
      workingOrder = pendingOrder;
    }

    if (requiresRefund) {
      const lockKey = `escrow_lock:${workingOrder.id}`;
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
        return res.status(409).json({ error: 'Refund is currently being processed. Please try again later.' });
      }

      try {
        let refundTxHash = workingOrder.refund_tx_hash ?? null;

        try {
          let receipt;

          if (refundTxHash) {
            receipt = await confirmEscrowRefund(refundTxHash);
          } else {
            const submitted = await submitEscrowRefund(order.order_display_id);
            refundTxHash = submitted.txHash;
            if (!refundTxHash || !submitted.waitForConfirmation) {
              throw new Error('Escrow refund transaction was not submitted.');
            }

            const submittedAt = new Date().toISOString();
            const { error: hashErr } = await orderRepository.updateOrderSelective(
              order.id,
              {
                refund_tx_hash: refundTxHash,
                escrow_refund_submitted_at: submittedAt,
                updated_at: submittedAt,
              },
              '*'
            );

            if (hashErr) {
              logger.error('[escrow] Failed to persist refund tx hash for order', orderId, ':', hashErr.message);
            }
            receipt = await submitted.waitForConfirmation();
          }

          const refundedAt = new Date().toISOString();
          const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrderWithFilter(
            order.id,
            {
              status: 'cancelled',
              cancellation_reason: reason ?? workingOrder.cancellation_reason,
              escrow_status: 'refunded',
              refund_tx_hash: receipt.hash ?? refundTxHash,
              escrow_refunded_at: refundedAt,
              escrow_refund_error: null,
              updated_at: refundedAt,
            },
            [
              { op: 'in', column: 'escrow_status', value: ['refund_pending', 'refund_failed'] },
            ],
            'cancellation_fee, order_display_id, status, cancellation_reason, escrow_status, refund_tx_hash'
          );

          if (updateErr) {
            logger.error('[escrow] Refund confirmed but final order update failed for', orderId, ':', updateErr.message);
            return res.status(202).json({
              message: 'Order cancelled and escrow refund confirmed. Database reconciliation is pending.',
              refund_tx_hash: receipt.hash ?? refundTxHash,
              escrow_status: 'refund_pending',
              reconciliation_required: true,
            });
          }

          await orderTimelineService.completeOrderPlacedMilestone(order.order_display_id, refundedAt);
          await expireDeliveryOtps(order.id);

          return res.json({
            message: 'Order cancelled and escrow refunded successfully.',
            cancellation_fee: updatedOrder?.cancellation_fee ?? 0,
            order: updatedOrder,
          });
        } catch (refundErr) {
          logger.error('[escrow] Refund failed for order', orderId, ':', refundErr.message);
          const failedAt = new Date().toISOString();
          const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
          await orderRepository.updateOrder(order.id, {
            status: 'cancelled',
            escrow_status: nextEscrowStatus,
            refund_tx_hash: refundTxHash,
            escrow_refund_error: String(refundErr.message || refundErr).slice(0, 1000),
            escrow_refund_last_attempt_at: failedAt,
            updated_at: failedAt,
          });

          return res.status(202).json({
            message: 'Order cancelled. Escrow refund requires reconciliation.',
            escrow_status: nextEscrowStatus,
            refund_tx_hash: refundTxHash,
            retryable: true,
          });
        }
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    } else if (order.escrow_booking_id) {
      logger.info(`[escrow] Escrow not funded (status: ${order.escrow_status}) — skipping on-chain refund.`);
    }

    const updatePayload = {
      status: 'cancelled',
      cancellation_reason: reason,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrder, error: updateErr } = await orderRepository.updateOrderWithFilter(
      order.id,
      updatePayload,
      [
        { op: 'not', column: 'status', operator: 'in', value: '("delivered","payment_released","cancelled")' },
      ],
      'cancellation_fee, order_display_id, status, cancellation_reason, escrow_status'
    );

    if (updateErr) {
      if (updateErr.code === 'PGRST116') {
        return res.status(409).json({ error: 'Order was already cancelled, delivered, or payment released. Cannot cancel.' });
      }
      return res.status(500).json({ error: 'Failed to cancel order.', details: updateErr.message });
    }

    const cancellationFee = updatedOrder?.cancellation_fee ?? 0;

    await orderRepository.updateTimelineMilestone(order.order_display_id, 'Order Placed', { completed: true, milestone_time: new Date().toISOString() });
    await expireDeliveryOtps(order.id);

    return res.json({ message: 'Order cancelled successfully.', cancellation_fee: cancellationFee, order: updatedOrder });
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

export default router;
