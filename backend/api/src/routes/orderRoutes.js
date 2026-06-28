import express from 'express';
import rateLimit from 'express-rate-limit';
import crypto from 'crypto';
import { ethers } from 'ethers';
import { bidLimiter, userLimiter } from '../middleware/rateLimiter.js';
import { supabase, redisClient, mongoDb } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { z } from 'zod';
import { computeOrderPricing } from '../lib/pricing.js';
import { getRouteEstimate, getRouteGeometry, buildStraightLineGeometry } from '../services/osrm.js';
import {
  createOrderSchema,
  submitBidSchema,
  submitRatingSchema,
  paramIdSchema,
  uuidParamSchema,
  acceptBidParamsSchema,
  updateMilestoneSchema,
  verifyDeliverySchema,
  predictDemandSchema,
  changeDropSchema,
  cancelOrderSchema
} from '../validation/requestSchemas.js';
import { awardReputationPoints } from '../services/reputation.js';
import { predictDemand, predictPrice } from '../services/ml.js';
import {
  buildDepositTx,
  recordDepositTx,
  escrowRelease,
  submitEscrowRefund,
  confirmEscrowRefund,
  ESCROW_MATIC_PER_PAISA,
} from '../services/escrow.js';
import { sendDeliveryOtpNotification, storeDeliveryOtp, getActiveDeliveryOtp, verifyDeliveryOtp, expireDeliveryOtps } from '../services/notificationService.js';
import logger from '../middleware/logger.js';

const router = express.Router();

// ── OTP brute-force protection (Redis + In-Memory Fallback) ────────────────────
const OTP_TTL_MINUTES = parseInt(process.env.OTP_TTL_MINUTES || '15', 10);
const OTP_MAX_FAILED_ATTEMPTS = parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10);
const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES || '30', 10);

const inMemoryOtpFailedAttempts = new Map();

function isOtpExpired(otpGeneratedAt) {
  if (!otpGeneratedAt) return true;
  const elapsed = Date.now() - new Date(otpGeneratedAt).getTime();
  return elapsed > OTP_TTL_MINUTES * 60 * 1000;
}

async function checkOtpLockout(orderId) {
  if (redisClient) {
    try {
      const lockKey = `otp_lockout:${orderId}`;
      const isLocked = await redisClient.get(lockKey);
      return !!isLocked;
    } catch (err) {
      logger.error('[OTP] Redis error in checkOtpLockout, falling back to memory:', err.message);
    }
  }
  const record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    inMemoryOtpFailedAttempts.delete(orderId);
    return false;
  }
  return true;
}

async function recordOtpFailure(orderId) {
  if (redisClient) {
    try {
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;
      
      const count = await redisClient.incr(countKey);
      if (count === 1) await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        await redisClient.set(lockKey, '1', 'EX', OTP_LOCKOUT_MINUTES * 60);
      }
      return count;
    } catch (err) {
      logger.error('[OTP] Redis error in recordOtpFailure, falling back to memory:', err.message);
    }
  }
  
  let record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record) {
    record = { count: 0, lockedUntil: null };
    inMemoryOtpFailedAttempts.set(orderId, record);
  }
  record.count += 1;
  if (record.count >= OTP_MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000;
  }
  return record.count;
}

async function clearOtpState(orderId) {
  if (redisClient) {
    try {
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;
      await redisClient.del(countKey, lockKey);
      return;
    } catch (err) {
      logger.error('[OTP] Redis error in clearOtpState, falling back to memory:', err.message);
    }
  }
  inMemoryOtpFailedAttempts.delete(orderId);
}


// Rate limiter for the verify-delivery endpoint
const verifyDeliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many delivery verification attempts. Please try again later.' },
});

// Rate limiter for updating order milestones
const milestoneLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 5,
  keyGenerator: (req) => req.user.id,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many milestone updates. Please slow down.' },
});

// Rate limiter for the predict-demand endpoint
const predictDemandLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: process.env.NODE_ENV === 'test' ? 1000 : 10,
  keyGenerator: (req) => {
    if (!req.user || !req.user.id) {
      throw new Error('User is not authenticated');
    }
    return req.user.id;
  },
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many demand prediction requests. Please try again later.' },
});

/**
 * Helper to generate order display IDs like #FF20260521
 */
function generateOrderDisplayId() {
  const prefix = '#FF';
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const random = Math.floor(100000 + Math.random() * 900000); // 6 random digits
  return `${prefix}${dateStr}${random}`;
}

// ============================================================================
// 1. CREATE AN ORDER (CUSTOMER)
// ============================================================================
router.post('/', authenticate, userLimiter, requireRole(['customer']), validateBody(createOrderSchema), async (req, res) => {
  const {
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    payment_method_id, upi_id
  } = req.body;

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
    if (!mlResult || typeof mlResult.estimated_price !== 'number' || mlResult.estimated_price <= 0) {
      throw new Error(`Invalid or non-positive price prediction: ${JSON.stringify(mlResult)}`);
    }
    estimatedPrice = Math.round(mlResult.estimated_price * 100);
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

    const { error: timelineErr } = await supabase.from('order_timeline').insert(milestones);

    if (timelineErr) {
      logger.error('Timeline Insertion Error:', timelineErr.message);
    }

    const { error: offerErr } = await supabase
      .from('load_offers')
      .insert({
        order_display_id: orderDisplayId,
        customer_id: req.user.id,
        customer_name: req.user.fullName || 'Customer',
        route_label: `${pickup_address.split(',')[0]} → ${drop_address.split(',')[0]}`,
        route_subtitle: `${weight_tonnes} tonnes • ${goods_type}`,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        goods_type,
        weight: `${weight_tonnes} tonnes`,
        freight_value: pricing.baseFreight,
        fuel_cost: pricing.fuelCost,
        toll_cost: pricing.tollEstimate,
        net_profit: pricing.netProfit,
        extra_distance_km: pricing.distanceKm,
        status: 'available'
      });

    if (offerErr) {
      logger.error('Load Offer Insertion Error:', offerErr.message);
    }

    // Verify pricing was stored correctly (integrity check)
    const { data: verifyOffer } = await supabase
      .from('load_offers')
      .select('freight_value, net_profit, fuel_cost, toll_cost, extra_distance_km')
      .eq('order_display_id', orderDisplayId)
      .single();

    if (verifyOffer && verifyOffer.freight_value !== pricing.baseFreight) {
      logger.error(`[SECURITY] Load offer pricing mismatch for ${orderDisplayId}: ` +
        `expected ${pricing.baseFreight}, got ${verifyOffer.freight_value}`);
    }

    res.status(201).json({ message: 'Order created successfully and broadcasted to loads board.', order });
  } catch (err) {
    logger.error('Order creation exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 2. FETCH MY ACTIVE ORDERS (CUSTOMER)
// ============================================================================
router.get('/my/active', authenticate, userLimiter, requireRole(['customer']), async (req, res) => {
  const activeStatuses = ['pending', 'active', 'truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving'];

  try {
    const { data: orders, error } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_id', req.user.id)
      .in('status', activeStatuses)
      .order('pickup_date', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch active orders.', details: error.message });

    const driverIds = [...new Set(orders.filter(o => o.driver_id).map(o => o.driver_id))];
    if (driverIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
      const driverMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
      orders.forEach(o => { o.driver_name = driverMap[o.driver_id] || 'Driver Assigned'; });
    }

    res.json(orders);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch active orders:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH LOAD OFFERS (MARKETPLACE)
// ============================================================================
router.get('/load-offers', authenticate, userLimiter, async (req, res) => {
  try {
    const { data: offers, error } = await supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', false)
      .order('created_at', { ascending: false });

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
  try {
    const { data: offers, error } = await supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', true)
      .order('created_at', { ascending: false });

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
    const { data: history, error } = await supabase
      .from('orders')
      .select('id, order_display_id, status, pickup_address, drop_address, pickup_date, total_amount, goods_type, driver_id, eta, created_at')
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch history.', details: error.message });

    const driverIds = [...new Set((history || []).filter(o => o.driver_id).map(o => o.driver_id))];
    if (driverIds.length > 0) {
      const { data: profiles } = await supabase.from('profiles').select('id, full_name').in('id', driverIds);
      const driverMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
      (history || []).forEach(o => { o.driver_name = driverMap[o.driver_id] || 'Driver Assigned'; });
    }

    res.json(history);
  } catch (err) {
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
    let { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (!order && !orderErr) {
      const result = await supabase.from('orders').select('*').eq('order_display_id', orderId).maybeSingle();
      order = result.data;
      orderErr = result.error;
    }
    if (orderErr) return res.status(500).json({ error: 'Query failed.', details: orderErr.message });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.customer_id !== req.user.id && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    const responseOrder = { ...order };

    const { data: timeline } = await supabase.from('order_timeline').select('milestone, milestone_time, completed, sort_order').eq('order_display_id', order.order_display_id).order('sort_order', { ascending: true });

    let driverProfile = null;
    if (order.driver_id) {
      const { data: profile } = await supabase.from('profiles').select('full_name, phone, avatar_url').eq('id', order.driver_id).maybeSingle();
      const { data: details } = await supabase.from('driver_details').select('rating, total_trips').eq('user_id', order.driver_id).maybeSingle();

      if (profile && details) {
        driverProfile = { name: profile.full_name, phone: profile.phone, avatar: profile.avatar_url, rating: details.rating, trips: details.total_trips };
      }
    }

    res.json({ order: responseOrder, timeline: timeline || [], driver: driverProfile });
  } catch (err) {
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
    let order;
    const { data: orderById } = await supabase.from('orders').select('customer_id, driver_id, order_display_id').eq('id', orderId).maybeSingle();
    if (orderById) {
      order = orderById;
    } else {
      const { data: orderByDisplay } = await supabase.from('orders').select('customer_id, driver_id, order_display_id').eq('order_display_id', orderId).maybeSingle();
      order = orderByDisplay;
    }

    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.customer_id !== req.user.id && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own or are not assigned to this order.' });
    }

    const { data: timeline, error: timelineErr } = await supabase
      .from('order_timeline')
      .select('milestone, milestone_time, completed, sort_order')
      .eq('order_display_id', order.order_display_id)
      .order('sort_order', { ascending: true });

    if (timelineErr) return res.status(500).json({ error: 'Failed to fetch timeline.', details: timelineErr.message });
    res.json(timeline || []);
  } catch (err) {
    logger.error("[orderRoutes] Failed to fetch order timeline:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. SUBMIT BID FOR LOAD OFFER (DRIVER)
// ============================================================================
router.post('/:id/bids', authenticate, userLimiter, requireRole(['driver']), bidLimiter, validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
  const loadOfferId = req.params.id;
  const { bid_amount } = req.body;

  try {
    const { data: offer, error: offerErr } = await supabase.from('load_offers').select('id, status, customer_id').eq('id', loadOfferId).maybeSingle();
    if (offerErr || !offer) return res.status(404).json({ error: 'Load offer not found.' });
    if (offer.status !== 'available') return res.status(410).json({ error: 'Load is no longer available for bidding.' });
    if (offer.customer_id === req.user.id) return res.status(403).json({ error: 'You cannot bid on your own load offer' });

    const { data: driverDetails, error: driverDetailsErr } = await supabase.from('driver_details').select('truck_id').eq('user_id', req.user.id).maybeSingle();
    if (driverDetailsErr) return res.status(500).json({ error: 'Failed to verify driver profile.', details: driverDetailsErr.message });
    if (!driverDetails?.truck_id) return res.status(400).json({ error: 'You must assign a valid truck to your profile before bidding on loads' });

    const { data: truck, error: truckErr } = await supabase.from('trucks').select('id').eq('id', driverDetails.truck_id).maybeSingle();
    if (truckErr) return res.status(500).json({ error: 'Failed to verify assigned truck.', details: truckErr.message });
    if (!truck) return res.status(400).json({ error: 'Assigned truck record could not be found' });

    const { data: existingBid, error: existingBidErr } = await supabase.from('load_bids').select('id').eq('load_id', loadOfferId).eq('driver_id', req.user.id).eq('status', 'pending').maybeSingle();
    if (existingBidErr) return res.status(500).json({ error: 'Failed to verify existing bids.', details: existingBidErr.message });
    if (existingBid) return res.status(409).json({ error: 'You already have a pending bid for this load.' });

    const { data: bid, error: bidErr } = await supabase.from('load_bids').insert({ load_id: loadOfferId, driver_id: req.user.id, bid_amount, status: 'pending' }).select('*').single();
    if (bidErr) return res.status(500).json({ error: 'Failed to record bid.', details: bidErr.message });

    res.status(201).json({ message: 'Bid submitted successfully.', bid });
  } catch (err) {
    logger.error("[orderRoutes] Failed to submit bid:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 9. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
// ============================================================================
router.post('/:id/ratings', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
  const orderId = req.params.id;
  const { stars, comment = null } = req.body;

  try {
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, order_display_id, customer_id, driver_id, status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      return res.status(500).json({ error: 'Failed to fetch order.', details: orderErr.message });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    if (order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    if (!['delivered', 'payment_released'].includes(order.status)) {
      return res.status(400).json({ error: 'Order must be delivered before a rating can be submitted.' });
    }

    if (!order.driver_id) {
      return res.status(400).json({ error: 'Order does not have an assigned driver.' });
    }

    const { data: existingRating, error: ratingCheckErr } = await supabase
      .from('ratings')
      .select('id')
      .eq('order_display_id', order.order_display_id)
      .eq('customer_id', req.user.id)
      .maybeSingle();

    if (ratingCheckErr) {
      return res.status(500).json({ error: 'Failed to verify existing rating.', details: ratingCheckErr.message });
    }

    if (existingRating) {
      return res.status(409).json({ error: 'A rating has already been submitted for this order.' });
    }

    const { error: rpcErr } = await supabase.rpc('submit_rating_tx', {
      p_order_display_id: order.order_display_id,
      p_customer_id: req.user.id,
      p_driver_id: order.driver_id,
      p_stars: stars,
      p_comment: comment,
    });

    if (rpcErr) {
      return res.status(500).json({ error: 'Failed to submit rating.', details: rpcErr.message });
    }

    // Fetch driver's registered Polygon wallet address for on-chain reputation update.
    // This is intentionally fire-and-forget — a blockchain failure must never block
    // the HTTP response. The Supabase rating is the source of truth.
    const { data: driverDetails } = await supabase
      .from('driver_details')
      .select('polygon_wallet_address')
      .eq('user_id', order.driver_id)
      .maybeSingle();

    const polygonAddress = driverDetails?.polygon_wallet_address ?? null;

    if (polygonAddress) {
      try {
        await awardReputationPoints(polygonAddress, stars);
      } catch (repErr) {
        logger.error('[reputation] On-chain reputation update failed:', repErr.message);
      }
    } else {
      logger.warn(
        `[reputation] Driver ${order.driver_id} has no polygon_wallet_address — skipping on-chain update.`
      );
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
    logger.error("[orderRoutes] Failed to submit rating:", err.message);
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 10. VIEW BIDS FOR AN ORDER (CUSTOMER)
// ============================================================================
router.get('/:id/bids', authenticate, userLimiter, requireRole(['customer']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const { data: order } = await supabase.from('orders').select('order_display_id, customer_id').eq('id', orderId).maybeSingle();
    if (!order || order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });

    const { data: offer } = await supabase.from('load_offers').select('id').eq('order_display_id', order.order_display_id).maybeSingle();
    if (!offer) return res.json([]);

    const { data: bids, error: bidErr } = await supabase.from('load_bids').select('*').eq('load_id', offer.id).eq('status', 'pending').order('bid_amount', { ascending: true });
    if (bidErr) return res.status(500).json({ error: 'Query failed.', details: bidErr.message });
    if (!bids || bids.length === 0) return res.json([]);

    const driverIds = bids.map(b => b.driver_id);
    const [profilesRes, detailsRes] = await Promise.all([
      supabase.from('profiles').select('id, full_name, avatar_url, phone').in('id', driverIds),
      supabase.from('driver_details').select('user_id, rating, total_trips, completion_rate, truck_id').in('user_id', driverIds)
    ]);

    const profiles = profilesRes.data || [];
    const details  = detailsRes.data || [];
    const truckIds = details.map(d => d.truck_id).filter(Boolean);
    const trucksRes = truckIds.length > 0 ? await supabase.from('trucks').select('id, name, number_plate').in('id', truckIds) : { data: [] };
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
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 11. ACCEPT BID (CUSTOMER)
// ============================================================================
router.post('/:id/bids/:bidId/accept', authenticate, userLimiter, requireRole(['customer']), validateParams(acceptBidParamsSchema), async (req, res) => {
  const orderId = req.params.id;
  const bidId = req.params.bidId;
  // Acquire a distributed lock on this order to prevent concurrent bid acceptance
  const lockKey = `bid_accept_lock:${orderId}`;
  const lockTimeoutMs = 10000;
  let lockValue = null;
  if (redisClient) {
    lockValue = crypto.randomUUID();
    const acquired = await redisClient.set(lockKey, lockValue, 'PX', lockTimeoutMs, 'NX');
    if (!acquired) {
      return res.status(409).json({ error: 'Another bid acceptance is in progress for this order. Please try again.' });
    }
  }
  try {
    const { data: order } = await supabase.from('orders').select('order_display_id, customer_id').eq('id', orderId).maybeSingle();
    if (!order || order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });

    const { data: bid } = await supabase.from('load_bids').select('*').eq('id', bidId).maybeSingle();
    if (!bid || bid.status !== 'pending') return res.status(404).json({ error: 'Bid is not active or not found.' });

    const { data: loadOffer, error: loadOfferErr } = await supabase.from('load_offers').select('id').eq('order_display_id', order.order_display_id).maybeSingle();
    if (loadOfferErr) return res.status(500).json({ error: 'Failed to verify bid ownership.', details: loadOfferErr.message });
    if (!loadOffer) return res.status(404).json({ error: 'Load offer for this order was not found.' });
    if (bid.load_id !== loadOffer.id) return res.status(403).json({ error: 'Access Denied: Bid does not belong to this order.' });

    // Fetch wallet addresses BEFORE any state change to validate escrow readiness
    const [driverDetailsResult, customerProfileResult] = await Promise.all([
      supabase.from('driver_details').select('polygon_wallet_address').eq('user_id', bid.driver_id).maybeSingle(),
      supabase.from('profiles').select('polygon_wallet_address').eq('id', req.user.id).maybeSingle(),
    ]);

    const driverWallet = driverDetailsResult.data?.polygon_wallet_address ?? null;
    const customerWallet = customerProfileResult.data?.polygon_wallet_address ?? null;

    if (!driverWallet || !customerWallet) {
      logger.warn(`[escrow] Missing wallet address: driver=${!!driverWallet}, customer=${!!customerWallet} — rejecting bid acceptance.`);
      return res.status(422).json({
        error: 'Both customer and driver must connect a wallet before escrow can be initiated.'
      });
    }

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', bid.driver_id).maybeSingle();
    const { data: details } = await supabase.from('driver_details').select('rating, truck_id').eq('user_id', bid.driver_id).maybeSingle();

    let truckInfo = null;
    if (details && details.truck_id) {
      const { data, error: truckErr } = await supabase.from('trucks').select('id, name, number_plate').eq('id', details.truck_id).maybeSingle();
      if (truckErr) logger.error('Truck lookup error during bid accept:', truckErr.message);
      truckInfo = data;
    }

    // Phase 1: Build unsigned deposit tx for customer to sign
    let depositTxData = null;
    if (driverWallet && customerWallet) {
      const maticPerPaisa = ESCROW_MATIC_PER_PAISA;
      if (!Number.isFinite(maticPerPaisa) || maticPerPaisa <= 0) {
        logger.warn('[escrow] ESCROW_MATIC_PER_PAISA not configured — skipping escrow deposit.');
      } else {
        const maticAmount = (bid.bid_amount * maticPerPaisa).toFixed(18);
        const maxEscrowMatic = Number.parseFloat(process.env.MAX_ESCROW_MATIC || '5');
        if (!Number.isFinite(maxEscrowMatic) || maxEscrowMatic <= 0) {
          logger.error('[escrow] MAX_ESCROW_MATIC is invalid — refusing deposit.');
          return res.status(500).json({ error: 'Escrow configuration error. Please contact support.' });
        }
        if (Number.parseFloat(maticAmount) > maxEscrowMatic) {
          return res.status(400).json({ error: 'Computed escrow amount exceeds safety cap. Check ESCROW_MATIC_PER_PAISA configuration.' });
        }
        const amountWei = ethers.parseEther(maticAmount);
        const { txData, bookingId } = await buildDepositTx(
          order.order_display_id, customerWallet, driverWallet, amountWei,
        );
        if (txData) {
          if (typeof txData === 'string' && txData.startsWith('0x')) {
            try {
              const parsed = ethers.Transaction.from(txData);
              depositTxData = {
                to: parsed.to,
                data: parsed.data,
                value: parsed.value ? parsed.value.toString() : undefined,
              };
            } catch (parseErr) {
              depositTxData = {
                to: process.env.ESCROW_CONTRACT_ADDRESS || '0x0000000000000000000000000000000000000000',
                data: txData,
              };
            }
          } else {
            depositTxData = txData;
          }
          await supabase.from('orders').update({
            escrow_booking_id: bookingId,
            escrow_status: 'funding',
          }).eq('id', orderId);
        }
      }
    }

    // Phase 2: Atomically accept the bid
    const { error: rpcErr } = await supabase.rpc('accept_bid_tx', {
      p_bid_id: bidId, p_order_id: orderId, p_load_id: bid.load_id, p_driver_id: bid.driver_id,
      p_truck_id: truckInfo?.id || null, p_driver_name: profile?.full_name || 'Assigned Driver',
      p_driver_rating: details?.rating || 0.00, p_truck_number: truckInfo?.number_plate || 'N/A',
      p_bid_amount: bid.bid_amount, p_order_display_id: order.order_display_id
    });

    if (rpcErr) {
      // Rollback the pre-update so the order is not left in an impossible state
      await supabase
        .from('orders')
        .update({ escrow_status: 'pending', escrow_booking_id: null })
        .eq('id', orderId);
      return res.status(500).json({
        error: 'Failed to accept bid atomically.',
        details: rpcErr.message,
        recovery: 'The pending escrow deposit has been voided. Please try again.'
      });
    }

    res.json({
      message: 'Bid accepted. Awaiting customer deposit signature.',
      depositTx: depositTxData,
    });
  } catch (err) {
    logger.error({ err }, '[orderRoutes] accept bid error');
    res.status(500).json({ error: 'Internal Server Error' });
  } finally {
    if (redisClient && lockValue) {
      const luaScript = `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          redis.call('DEL', KEYS[1])
          return 1
        end
        return 0
      `;
      try {
        await redisClient.eval(luaScript, 1, lockKey, lockValue);
      } catch (err) {
        logger.warn('[orderRoutes] Failed to release accept-bid lock for key %s: %s', lockKey, err.message);
      }
    }
  }
});

// ============================================================================
// 12. UPDATE ORDER MILESTONE (ASSIGNED DRIVER)
// ============================================================================
router.put('/:id/milestones', authenticate, userLimiter, requireRole(['driver']), milestoneLimiter, validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;

  const milestoneMap = {
    'Truck Assigned': 'truck_assigned',
    'En Route to Pickup': 'en_route_pickup',
    'Arrived at Pickup': 'arrived_pickup',
    'Goods Loaded': 'picked_up',
    'In Transit': 'in_transit',
    'Arriving': 'arriving',
  };

  if (milestone === 'Delivered') return res.status(400).json({ error: 'Cannot set Delivered milestone directly. Use /verify-delivery endpoint to confirm delivery.' });

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found.' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });

    const { data: timeline, error: tlErr } = await supabase
      .from('order_timeline')
      .select('milestone, sort_order, completed')
      .eq('order_display_id', order.order_display_id)
      .order('sort_order', { ascending: true });
    if (tlErr) return res.status(500).json({ error: 'Failed to fetch order timeline.' });

    const canonicalMilestones = new Set([...Object.keys(milestoneMap), 'Order Placed', 'Delivered']);
    const lastCompleted = [...timeline].reverse().find(t => t.completed && canonicalMilestones.has(t.milestone));
    const lastCompletedSortOrder = lastCompleted ? lastCompleted.sort_order : 10;

    const timelineEntry = timeline.find(t => t.milestone === milestone);
    if (!timelineEntry) return res.status(400).json({ error: `Milestone "${milestone}" is not part of this order's timeline.` });

    if (timelineEntry.completed) {
      return res.status(409).json({ error: `Milestone "${milestone}" has already been completed.` });
    }

    const nextExpected = timeline.find(t => !t.completed && t.sort_order > lastCompletedSortOrder);
    if (!nextExpected || nextExpected.sort_order !== timelineEntry.sort_order) {
      return res.status(422).json({
        error: `Milestone out of sequence. Expected "${nextExpected ? nextExpected.milestone : 'none'}" before "${milestone}".`,
      });
    }

    const status = milestoneMap[milestone];
    const updates = { status, updated_at: new Date().toISOString() };
    let generatedOtp = null;

    if (milestone === 'In Transit') {
      const activeOtp = await getActiveDeliveryOtp(orderId);
      if (!activeOtp) {
        generatedOtp = crypto.randomInt(100000, 1000000).toString();
        const stored = await storeDeliveryOtp(orderId, generatedOtp, OTP_TTL_MINUTES);
        if (stored) {
          await clearOtpState(orderId);
        }
      } else {
        logger.warn(`[OTP] Driver ${req.user.id} attempted OTP regeneration for order ${orderId}`);
      }
    }

    const { error: timelineErr } = await supabase.from('order_timeline').update({ completed: true, milestone_time: new Date().toISOString() }).eq('order_display_id', order.order_display_id).eq('milestone', milestone);
    if (timelineErr) return res.status(500).json({ error: 'Failed to update order timeline.', details: timelineErr.message });

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders').update(updates).eq('id', orderId).select('*').single();
    if (updateErr) {
      // Roll back the timeline mark since the order update failed
      await supabase
        .from('order_timeline')
        .update({ completed: false, milestone_time: null })
        .eq('order_display_id', order.order_display_id)
        .eq('milestone', milestone);
      return res.status(500).json({ error: 'Failed to update order.', details: updateErr.message });
    }

    if (generatedOtp) {
      const notifResult = await sendDeliveryOtpNotification(order.customer_id, order.order_display_id, generatedOtp);
      if (!notifResult.success) {
        logger.warn(`[OrderRoutes] Delivery OTP notification failed for order ${order.order_display_id} — FCM error: ${notifResult.fcm?.error || 'unknown'}`);
        await supabase.from('orders').update({
          notification_failed: true,
          updated_at: new Date().toISOString(),
        }).eq('id', orderId);
      }
    }

    const response = { message: 'Milestone updated successfully.', order: updatedOrder, milestone, status };

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 13. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
// ============================================================================
router.post('/:id/verify-delivery', authenticate, userLimiter, requireRole(['driver']), verifyDeliveryLimiter, validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
  const orderId = req.params.id;
  const { otp } = req.body;

  // Check for active lockout from previous failed attempts
  if (await checkOtpLockout(orderId)) {
    return res.status(429).json({
      error: `Too many failed OTP attempts. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
    });
  }

  try {
    const { data: order, error: orderErr } = await supabase.from('orders')
      .select('id, order_display_id, driver_id, customer_id, escrow_status, escrow_release_attempts, status')
      .eq('id', orderId)
      .maybeSingle();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found.' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });

    const otpRecord = await getActiveDeliveryOtp(orderId);
    if (!otpRecord) {
      return res.status(400).json({
        error: 'OTP not available or has expired. Please request a new delivery OTP.',
      });
    }

    const submittedHash = crypto.createHash('sha256').update(String(otp)).digest('hex');
    if (otpRecord.otp_hash !== submittedHash) {
      const count = await recordOtpFailure(orderId);
      const remaining = Math.max(0, OTP_MAX_FAILED_ATTEMPTS - count);
      const message = remaining > 0
        ? `Invalid OTP. ${remaining} attempt(s) remaining before lockout.`
        : `Invalid OTP. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes due to too many failed attempts.`;
      logger.warn(`[OTP] Failed verification attempt for order ${orderId} by driver ${req.user.id}. ${remaining} attempts remaining.`);
      return res.status(400).json({ error: message });
    }

    // Guard against cancellation or a previous successful verification.
    const { data: preUpdatedOrder, error: updateErr } = await supabase.from('orders').update({
      updated_at: new Date().toISOString()
    })
      .eq('id', orderId)
      .not('status', 'eq', 'cancelled')
      .not('status', 'eq', 'payment_released')
      .select('id, order_display_id, status')
      .single();

    if (updateErr) {
      if (updateErr.code === 'PGRST116') {
        return res.status(409).json({ error: 'Order was already cancelled or payment released.' });
      }
      return res.status(500).json({ error: 'Failed to verify OTP.', details: updateErr.message });
    }

    // Call complete_trip_tx RPC to atomically update trip, driver stats, wallet, earnings, order status, and timeline.
    const { error: rpcErr } = await supabase.rpc('complete_trip_tx', {
      p_order_id: orderId,
      p_otp_id: otpRecord.id,
    });
    if (rpcErr) {
      logger.error('complete_trip_tx RPC failed:', rpcErr.message);
      return res.status(500).json({ error: 'Failed to complete trip and release payment.', details: rpcErr.message });
    }

    // Clear brute-force state only after the OTP and trip transaction commits.
    await clearOtpState(orderId);
    // Post-RPC verification: confirm the order was actually updated to payment_released
    const { data: verifiedOrder, error: verifyErr } = await supabase
      .from('orders')
      .select('status, escrow_status, escrow_release_attempts')
      .eq('id', orderId)
      .maybeSingle();

    if (verifyErr || !verifiedOrder) {
      logger.error(`[verify-delivery] Failed to verify order status after RPC for order ${orderId}`);
      return res.status(500).json({ error: 'Failed to verify order status after payment release.' });
    }

    if (verifiedOrder.status !== 'payment_released') {
      logger.warn(`[verify-delivery] Order ${orderId} status changed to "${verifiedOrder.status}" — payment was not released.`);
      return res.status(409).json({
        error: 'Order status changed during processing. Payment was not released.',
      });
    }

    // OTP is only consumed after the RPC succeeds — if the RPC fails the driver can retry
    await verifyDeliveryOtp(orderId);
    await clearOtpState(orderId);
    // Escrow: release funds to driver after successful delivery verification
    let escrowReleased = false;
    if (verifiedOrder.escrow_status === 'funded') {
      const releaseAttemptedAt = new Date().toISOString();
      const releaseAttempts = (verifiedOrder.escrow_release_attempts || 0) + 1;
      const { error: pendingErr } = await supabase.from('orders').update({
        escrow_status: 'release_pending',
        escrow_release_error: null,
        escrow_release_attempts: releaseAttempts,
        escrow_release_last_attempt_at: releaseAttemptedAt,
      }).eq('id', orderId);

      if (pendingErr) {
        logger.error('[escrow] Failed to persist release_pending state:', pendingErr.message);
        return res.status(202).json({
          message: 'Delivery verified successfully. Escrow payout is pending reconciliation.',
          escrow_status: 'release_pending',
          payment_released: false,
        });
      }

      try {
        const { txHash } = await escrowRelease(order.order_display_id);
        if (!txHash) {
          throw new Error('Escrow release did not return a transaction hash');
        }

        const { error: releaseUpdateErr } = await supabase.from('orders').update({
          escrow_status: 'released',
          release_tx_hash: txHash,
          escrow_release_error: null,
          escrow_released_at: new Date().toISOString(),
        }).eq('id', orderId);

        if (releaseUpdateErr) {
          logger.error('[escrow] Release confirmed but persistence failed:', releaseUpdateErr.message);
          return res.status(202).json({
            message: 'Delivery verified successfully. Escrow release was submitted and requires reconciliation.',
            escrow_status: 'release_pending',
            payment_released: false,
            release_tx_hash: txHash,
          });
        }

        if (order.driver_id) {
          const { error: walletErr } = await supabase
            .from('wallet_transactions')
            .update({
              tx_hash: txHash,
              description: `Escrow payout for ${order.order_display_id}`,
            })
            .eq('driver_id', order.driver_id)
            .eq('order_display_id', order.order_display_id)
            .eq('txn_type', 'credit');

          if (walletErr) {
            logger.error(
              '[wallet] Failed to persist escrow payout:',
              walletErr.message
            );
          }
          escrowReleased = true;
        }
      } catch (releaseErr) {
        logger.error('[escrow] Release failed for order', orderId, ':', releaseErr.message);
        const releaseError = String(releaseErr.message || 'Unknown escrow release error').slice(0, 1000);
        const { error: failureUpdateErr } = await supabase.from('orders').update({
          escrow_status: 'release_failed',
          escrow_release_error: releaseError,
          escrow_release_last_attempt_at: releaseAttemptedAt,
        }).eq('id', orderId);

        if (failureUpdateErr) {
          logger.error('[escrow] Failed to persist release failure:', failureUpdateErr.message);
        }

        return res.status(202).json({
          message: 'Delivery verified successfully. Escrow payout is pending retry.',
          escrow_status: 'release_failed',
          payment_released: false,
          retryable: true,
        });
      }
    } else {
      logger.info(`[escrow] Escrow not funded (status: ${order.escrow_status}) — skipping on-chain release.`);
    }

    if (order.escrow_status !== 'funded' || escrowReleased) {
      res.json({ message: 'Delivery verified successfully! Payment released to driver.' });
    } else {
      res.status(500).json({ error: 'Delivery verified but on-chain escrow release failed. Contact support.' });
    }
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 14. RESEND DELIVERY OTP (DRIVER)
// ============================================================================
router.post('/:id/resend-otp', authenticate, userLimiter, requireRole(['driver']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('id, order_display_id, driver_id, customer_id, status').eq('id', orderId).maybeSingle();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found.' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });

    const terminalStatuses = ['delivered', 'cancelled', 'payment_released'];
    if (terminalStatuses.includes(order.status)) {
      return res.status(400).json({ error: 'Cannot resend OTP for a completed or cancelled order.' });
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const stored = await storeDeliveryOtp(orderId, otp, OTP_TTL_MINUTES);
    if (!stored) {
      return res.status(500).json({ error: 'Failed to generate delivery OTP.' });
    }

    await clearOtpState(orderId);

    const notifResult = await sendDeliveryOtpNotification(order.customer_id, order.order_display_id, otp);
    if (!notifResult.success) {
      logger.warn(`[OrderRoutes] Resend OTP notification failed for order ${order.order_display_id} — FCM error: ${notifResult.fcm?.error || 'unknown'}`);
    }

    res.json({ message: 'New delivery OTP sent.', expiresInMinutes: OTP_TTL_MINUTES });
  } catch (err) {
    logger.error('[OrderRoutes] Resend OTP error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 15. CHANGE DROP (CUSTOMER)
// ============================================================================
router.put('/:id/change-drop', authenticate, userLimiter, requireRole(['customer']), validateParams(uuidParamSchema), validateBody(changeDropSchema), async (req, res) => {
  const orderId = req.params.id;
  const { drop_address, drop_lat, drop_lng } = req.body;

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr) return res.status(500).json({ error: 'Failed to fetch order.', details: orderErr.message });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    if (order.escrow_status === 'funded') {
      return res.status(409).json({
        error: 'Drop location cannot be changed after escrow has been funded.',
        recovery: 'Cancel this order to receive a refund, then rebook with the correct destination.',
      });
    }
    if (order.weight_tonnes == null) return res.status(500).json({ error: 'Data inconsistency: Order is missing weight_tonnes.' });

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

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders').update(updates).eq('id', order.id).select('*').single();
    if (updateErr) return res.status(500).json({ error: 'Failed to update order.', details: updateErr.message });

    const { error: offerUpdateErr } = await supabase
      .from('load_offers')
      .update({
        drop_address,
        drop_lat: Number(drop_lat),
        drop_lng: Number(drop_lng),
        route_label: `${(order.pickup_address || '').split(',')[0]} → ${drop_address.split(',')[0]}`,
        freight_value: pricing.baseFreight,
        fuel_cost: pricing.fuelCost,
        toll_cost: pricing.tollEstimate,
        net_profit: pricing.netProfit,
        extra_distance_km: pricing.distanceKm,
      })
      .eq('order_display_id', order.order_display_id);

    if (offerUpdateErr) {
      logger.error('Load offer update failed for change-drop:', offerUpdateErr.message);
    }

    try {
      await supabase.from('order_timeline').insert({ order_display_id: order.order_display_id, milestone: 'Drop Changed', milestone_time: new Date().toISOString(), completed: true, sort_order: 25 });
    } catch (timelineErr) {
      logger.warn('Failed to update timeline for change-drop:', timelineErr.message);
    }

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
    logger.error('Change drop exception:', err.message);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 16. CANCEL ORDER AND REFUND ESCROW (CUSTOMER)
// ============================================================================
router.post('/:id/cancel', authenticate, userLimiter, requireRole(['customer']), validateParams(uuidParamSchema), validateBody(cancelOrderSchema), async (req, res) => {
  const orderId = req.params.id;
  const { reason = null } = req.body || {};

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr) return res.status(500).json({ error: 'Failed to fetch order.', details: orderErr.message });
    if (!order) return res.status(404).json({ error: 'Order not found.' });
    if (order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });

    // Prevent cancellation if delivery OTP was already verified
    const { data: otpCheck, error: otpCheckErr } = await supabase
      .from('delivery_otps')
      .select('id')
      .eq('order_id', order.id)
      .eq('verified', true)
      .limit(1)
      .maybeSingle();

    if (!otpCheckErr && otpCheck) {
      return res.status(409).json({ error: 'Cannot cancel: delivery OTP has already been verified.' });
    }

    if (order.status === 'cancelled' && order.escrow_status === 'refunded') {
      return res.json({
        message: 'Order was already cancelled and refunded.',
        cancellation_fee: order.cancellation_fee ?? 0,
        order,
      });
    }

    const requiresRefund = ['funded', 'refund_pending', 'refund_failed'].includes(order.escrow_status);
    let workingOrder = order;

    // Persist cancellation before touching the blockchain. A failed or delayed
    // refund must never leave the order available for continued work.
    if (requiresRefund && (order.status !== 'cancelled' || order.escrow_status !== 'refund_pending')) {
      const attemptAt = new Date().toISOString();
      const { data: pendingOrder, error: pendingErr } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          cancellation_reason: reason ?? order.cancellation_reason,
          escrow_status: 'refund_pending',
          escrow_refund_error: null,
          escrow_refund_attempts: (order.escrow_refund_attempts ?? 0) + 1,
          escrow_refund_last_attempt_at: attemptAt,
          updated_at: attemptAt,
        })
        .eq('id', order.id)
        .not('status', 'in', '("delivered","payment_released")')
        .select('*')
        .single();

      if (pendingErr) {
        if (pendingErr.code === 'PGRST116') {
          return res.status(409).json({ error: 'Order was already delivered or payment released. Cannot cancel.' });
        }
        return res.status(500).json({
          error: 'Failed to place the order into refund reconciliation.',
          details: pendingErr.message,
        });
      }
      workingOrder = pendingOrder;
    }

    if (requiresRefund) {
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
          const { error: hashErr } = await supabase
            .from('orders')
            .update({
              refund_tx_hash: refundTxHash,
              escrow_refund_submitted_at: submittedAt,
              updated_at: submittedAt,
            })
            .eq('id', order.id)
            .eq('escrow_status', 'refund_pending');

          if (hashErr) {
            logger.error('[escrow] Failed to persist refund tx hash for order', orderId, ':', hashErr.message);
          }
          receipt = await submitted.waitForConfirmation();
        }

        const refundedAt = new Date().toISOString();
        const { data: updatedOrder, error: updateErr } = await supabase
          .from('orders')
          .update({
            status: 'cancelled',
            cancellation_reason: reason ?? workingOrder.cancellation_reason,
            escrow_status: 'refunded',
            refund_tx_hash: receipt.hash ?? refundTxHash,
            escrow_refunded_at: refundedAt,
            escrow_refund_error: null,
            updated_at: refundedAt,
          })
          .eq('id', order.id)
          .in('escrow_status', ['refund_pending', 'refund_failed'])
          .select('cancellation_fee, order_display_id, status, cancellation_reason, escrow_status, refund_tx_hash')
          .single();

        if (updateErr) {
          logger.error('[escrow] Refund confirmed but final order update failed for', orderId, ':', updateErr.message);
          return res.status(202).json({
            message: 'Order cancelled and escrow refund confirmed. Database reconciliation is pending.',
            refund_tx_hash: receipt.hash ?? refundTxHash,
            escrow_status: 'refund_pending',
            reconciliation_required: true,
          });
        }

        await supabase.from('order_timeline').update({ completed: true, milestone_time: refundedAt })
          .eq('order_display_id', order.order_display_id)
          .eq('milestone', 'Order Placed');

        return res.json({
          message: 'Order cancelled and escrow refunded successfully.',
          cancellation_fee: updatedOrder?.cancellation_fee ?? 0,
          order: updatedOrder,
        });
      } catch (refundErr) {
        logger.error('[escrow] Refund failed for order', orderId, ':', refundErr.message);
        const failedAt = new Date().toISOString();
        const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
        await supabase.from('orders').update({
          status: 'cancelled',
          escrow_status: nextEscrowStatus,
          refund_tx_hash: refundTxHash,
          escrow_refund_error: String(refundErr.message || refundErr).slice(0, 1000),
          escrow_refund_last_attempt_at: failedAt,
          updated_at: failedAt,
        }).eq('id', order.id);

        return res.status(202).json({
          message: 'Order cancelled. Escrow refund requires reconciliation.',
          escrow_status: nextEscrowStatus,
          refund_tx_hash: refundTxHash,
          retryable: true,
        });
      }
    } else if (order.escrow_booking_id) {
      logger.info(`[escrow] Escrow not funded (status: ${order.escrow_status}) — skipping on-chain refund.`);
    }

    const updatePayload = {
      status: 'cancelled',
      cancellation_reason: reason,
      updated_at: new Date().toISOString(),
    };

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders')
      .update(updatePayload)
      .eq('id', order.id)
      .not('status', 'in', '("delivered","payment_released","cancelled")')
      .select('cancellation_fee, order_display_id, status, cancellation_reason, escrow_status')
      .single();
    if (updateErr) {
      if (updateErr.code === 'PGRST116') {
        return res.status(409).json({ error: 'Order was already cancelled, delivered, or payment released. Cannot cancel.' });
      }
      return res.status(500).json({ error: 'Failed to cancel order.', details: updateErr.message });
    }

    const cancellationFee = updatedOrder?.cancellation_fee ?? 0;

    await supabase.from('order_timeline').update({ completed: true, milestone_time: new Date().toISOString() })
      .eq('order_display_id', order.order_display_id)
      .eq('milestone', 'Order Placed');

    return res.json({ message: 'Order cancelled successfully.', cancellation_fee: cancellationFee, order: updatedOrder });
  } catch (err) {
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
  const orderId = req.params.id;
  const { txHash } = req.body;

  try {
    const { data: order, error: fetchErr } = await supabase
      .from('orders')
      .select('id, order_display_id, escrow_booking_id, escrow_status')
      .eq('id', orderId)
      .maybeSingle();

    if (fetchErr || !order) return res.status(404).json({ error: 'Order not found' });
    if (order.escrow_status !== 'funding') {
      return res.status(400).json({ error: 'Order is not in funding state' });
    }

    const bookingId = order.escrow_booking_id || `escrow:${order.order_display_id}`;
    const result = await recordDepositTx(bookingId, txHash);

    if (result.error) return res.status(422).json({ error: result.error });

    const { error: updateErr } = await supabase.from('orders').update({
      escrow_status: 'funded',
      deposit_tx_hash: result.txHash,
      escrow_deposited_at: new Date().toISOString(),
    }).eq('id', orderId);

    if (updateErr) {
      logger.error('[confirm-deposit] DB update failed:', updateErr.message);
      return res.status(500).json({ error: 'Database update failed after deposit confirmation. Please contact support.' });
    }

    res.json({ message: 'Escrow deposit confirmed', txHash: result.txHash });
  } catch (err) {
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
router.get('/:id/driver-location', authenticate, userLimiter, requireRole(['customer', 'driver']), validateParams(uuidParamSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    // 1. Resolve order and check authentication / authorization
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, customer_id, driver_id, status')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      return res.status(500).json({ error: 'Failed to fetch order details.' });
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Authorization: User must be either the customer who owns the order or the assigned driver
    if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }
    if (req.user.role === 'driver' && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    }

    if (!order.driver_id) {
      return res.status(404).json({ error: 'No driver assigned to this order.' });
    }

    // 2. Query MongoDB telemetry collection
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
      timestamp: telemetry.timestamp
    });

  } catch (err) {
    logger.error({ err }, 'Fetch driver location exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 20. GET LIVE ROUTE GEOMETRY (CUSTOMER OR DRIVER)
// ============================================================================

router.get('/:id/route', authenticate, userLimiter, requireRole(['customer', 'driver']), validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id; // this is order_display_id from client

  try {
    // 1. Resolve order and check authentication / authorization
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('id, customer_id, driver_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng')
      .eq('order_display_id', orderId)
      .maybeSingle();

    if (orderErr) {
      return res.status(500).json({ error: 'Failed to fetch order details.' });
    }
    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Authorization: User must be either the customer who owns the order or the assigned driver
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
      return res.status(404).json({ error: 'No driver assigned to this order.' });
    }

    // 2. Query MongoDB telemetry collection for the driver's latest position
    if (!mongoDb) {
      return res.status(503).json({ error: 'Telemetry database not available.' });
    }

    const latestTelemetry = await mongoDb
      .collection('telemetry')
      .find({ driver_id: order.driver_id })
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

    // 3. Call OSRM for a road-following route, falling back to a straight
    // line if OSRM is unavailable so the tracking screen never goes blank.
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
    logger.error({ err }, 'Fetch order route exception');
    return res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
