import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { computeOrderPricing } from '../lib/pricing.js';
import { getRouteEstimate } from '../services/osrm.js';
import {
  createOrderSchema,
  submitBidSchema,
  submitRatingSchema,
  paramIdSchema,
  acceptBidParamsSchema,
  updateMilestoneSchema,
  verifyDeliverySchema
} from '../validation/requestSchemas.js';
import { awardReputationPoints } from '../services/reputation.js';
import rateLimit from 'express-rate-limit';

const router = express.Router();

// ── OTP brute-force protection (in-memory state) ────────────────────
const OTP_TTL_MINUTES = parseInt(process.env.OTP_TTL_MINUTES || '15', 10);
const OTP_MAX_FAILED_ATTEMPTS = parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10);
const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES || '30', 10);

// Map<orderId, { count: number, lockedUntil: number|null }>
const otpFailedAttempts = new Map();

function isOtpExpired(otpGeneratedAt) {
  if (!otpGeneratedAt) return true;
  const elapsed = Date.now() - new Date(otpGeneratedAt).getTime();
  return elapsed > OTP_TTL_MINUTES * 60 * 1000;
}

function checkOtpLockout(orderId) {
  const record = otpFailedAttempts.get(orderId);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    otpFailedAttempts.delete(orderId);
    return false;
  }
  return true;
}

function recordOtpFailure(orderId) {
  let record = otpFailedAttempts.get(orderId);
  if (!record) {
    record = { count: 0, lockedUntil: null };
    otpFailedAttempts.set(orderId, record);
  }
  record.count += 1;
  if (record.count >= OTP_MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000;
  }
}

function clearOtpState(orderId) {
  otpFailedAttempts.delete(orderId);
}

// Rate limiter for the verify-delivery endpoint
const verifyDeliveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many delivery verification attempts. Please try again later.' },
});

/**
 * Helper to generate order display IDs like #FF20260521
 */
function generateOrderDisplayId() {
  const prefix = '#FF';
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, ''); // YYYYMMDD
  const random = Math.floor(1000 + Math.random() * 9000); // 4 random digits
  return `${prefix}${dateStr}${random}`;
}

// ============================================================================
// 1. CREATE AN ORDER (CUSTOMER)
// ============================================================================
router.post('/', authenticate, requireRole(['customer']), validateBody(createOrderSchema), async (req, res) => {
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
    console.error('Pricing computation error:', pricingErr.message);
    return res.status(400).json({
      error: 'Unable to compute freight pricing for the given route/cargo.',
      details: pricingErr.message,
    });
  }

  const orderDisplayId = generateOrderDisplayId();

  try {
    const { data: order, error: orderErr } = await supabase
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
        payment_method_id, upi_id
      })
      .select('id, order_display_id, status, created_at')
      .single();

    if (orderErr) {
      console.error('Order Insertion Error:', orderErr.message);
      return res.status(500).json({ error: 'Failed to create order record.', details: orderErr.message });
    }

    const milestones = [
      { order_display_id: orderDisplayId, milestone: 'Order Placed', milestone_time: new Date().toISOString(), completed: true, sort_order: 10 },
      { order_display_id: orderDisplayId, milestone: 'Truck Assigned', milestone_time: null, completed: false, sort_order: 20 },
      { order_display_id: orderDisplayId, milestone: 'En Route to Pickup', milestone_time: null, completed: false, sort_order: 30 },
      { order_display_id: orderDisplayId, milestone: 'Goods Loaded', milestone_time: null, completed: false, sort_order: 40 },
      { order_display_id: orderDisplayId, milestone: 'In Transit', milestone_time: null, completed: false, sort_order: 50 },
      { order_display_id: orderDisplayId, milestone: 'Delivered', milestone_time: null, completed: false, sort_order: 60 }
    ];

    const { error: timelineErr } = await supabase.from('order_timeline').insert(milestones);

    if (timelineErr) {
      console.error('Timeline Insertion Error:', timelineErr.message);
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
        status: 'available'
      });

    if (offerErr) {
      console.error('Load Offer Insertion Error:', offerErr.message);
    }

    res.status(201).json({ message: 'Order created successfully and broadcasted to loads board.', order });
  } catch (err) {
    console.error('Order creation exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 2. FETCH ORDER HISTORY (CUSTOMER)
// ============================================================================
router.get('/history', authenticate, requireRole(['customer']), async (req, res) => {
  try {
    const { data: history, error } = await supabase
      .from('orders')
      .select('id, order_display_id, status, pickup_address, drop_address, pickup_date, total_amount, goods_type, driver_name, eta, created_at')
      .eq('customer_id', req.user.id)
      .order('created_at', { ascending: false });

    if (error) return res.status(500).json({ error: 'Failed to fetch history.', details: error.message });
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id', authenticate, validateParams(paramIdSchema), async (req, res) => {
  const orderId = req.params.id;

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr) return res.status(500).json({ error: 'Query failed.', details: orderErr.message });
    if (!order) return res.status(404).json({ error: 'Order not found.' });

    if (order.customer_id !== req.user.id && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    const { data: timeline } = await supabase.from('order_timeline').select('milestone, milestone_time, completed, sort_order').eq('order_display_id', order.order_display_id).order('sort_order', { ascending: true });

    let driverProfile = null;
    if (order.driver_id) {
      const { data: profile } = await supabase.from('profiles').select('full_name, phone, avatar_url').eq('id', order.driver_id).maybeSingle();
      const { data: details } = await supabase.from('driver_details').select('rating, total_trips').eq('user_id', order.driver_id).maybeSingle();

      if (profile && details) {
        driverProfile = { name: profile.full_name, phone: profile.phone, avatar: profile.avatar_url, rating: details.rating, trips: details.total_trips };
      }
    }

    res.json({ order, timeline: timeline || [], driver: driverProfile });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. SUBMIT BID FOR LOAD OFFER (DRIVER)
// ============================================================================
router.post('/:id/bids', authenticate, requireRole(['driver']), validateParams(paramIdSchema), validateBody(submitBidSchema), async (req, res) => {
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
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 5. SUBMIT RATING FOR A DELIVERED ORDER (CUSTOMER)
// ============================================================================
router.post('/:id/ratings', authenticate, requireRole(['customer']), validateParams(paramIdSchema), validateBody(submitRatingSchema), async (req, res) => {
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
      // Non-blocking — do not await on the critical response path.
      awardReputationPoints(polygonAddress, stars).catch(err =>
        console.error('[reputation] Unhandled rejection in awardReputationPoints:', err.message)
      );
    } else {
      console.warn(
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
    return res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 6. VIEW BIDS FOR AN ORDER (CUSTOMER)
// ============================================================================
router.get('/:id/bids', authenticate, requireRole(['customer']), validateParams(paramIdSchema), async (req, res) => {
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
// 7. ACCEPT BID (CUSTOMER)
// ============================================================================
router.post('/:id/bids/:bidId/accept', authenticate, requireRole(['customer']), validateParams(acceptBidParamsSchema), async (req, res) => {
  const orderId = req.params.id;
  const bidId = req.params.bidId;

  try {
    const { data: order } = await supabase.from('orders').select('order_display_id, customer_id').eq('id', orderId).maybeSingle();
    if (!order || order.customer_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You do not own this order.' });

    const { data: bid } = await supabase.from('load_bids').select('*').eq('id', bidId).maybeSingle();
    if (!bid || bid.status !== 'pending') return res.status(404).json({ error: 'Bid is not active or not found.' });

    const { data: loadOffer, error: loadOfferErr } = await supabase.from('load_offers').select('id').eq('order_display_id', order.order_display_id).maybeSingle();
    if (loadOfferErr) return res.status(500).json({ error: 'Failed to verify bid ownership.', details: loadOfferErr.message });
    if (!loadOffer) return res.status(404).json({ error: 'Load offer for this order was not found.' });
    if (bid.load_id !== loadOffer.id) return res.status(403).json({ error: 'Access Denied: Bid does not belong to this order.' });

    const { data: profile } = await supabase.from('profiles').select('full_name').eq('id', bid.driver_id).maybeSingle();
    const { data: details } = await supabase.from('driver_details').select('rating, truck_id').eq('user_id', bid.driver_id).maybeSingle();

    let truckInfo = null;
    if (details && details.truck_id) {
      const { data, error: truckErr } = await supabase.from('trucks').select('id, name, number_plate').eq('id', details.truck_id).maybeSingle();
      if (truckErr) console.error('Truck lookup error during bid accept:', truckErr.message);
      truckInfo = data;
    }

    const { error: rpcErr } = await supabase.rpc('accept_bid_tx', {
      p_bid_id: bidId, p_order_id: orderId, p_load_id: bid.load_id, p_driver_id: bid.driver_id,
      p_truck_id: truckInfo?.id || null, p_driver_name: profile?.full_name || 'Assigned Driver',
      p_driver_rating: details?.rating || 0.00, p_truck_number: truckInfo?.number_plate || 'N/A',
      p_bid_amount: bid.bid_amount, p_order_display_id: order.order_display_id
    });

    if (rpcErr) return res.status(500).json({ error: 'Failed to accept bid atomically.', details: rpcErr.message });

    res.json({ message: 'Bid accepted. Driver and truck assigned.' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 8. UPDATE ORDER MILESTONE (ASSIGNED DRIVER)
// ============================================================================
router.put('/:id/milestones', authenticate, requireRole(['driver']), validateParams(paramIdSchema), validateBody(updateMilestoneSchema), async (req, res) => {
  const orderId = req.params.id;
  const { milestone } = req.body;

  const milestoneMap = {
    'Truck Assigned': 'truck_assigned',
    'En Route to Pickup': 'truck_assigned',
    'Goods Loaded': 'picked_up',
    'In Transit': 'in_transit',
    'Arriving': 'arriving',
  };

  if (milestone === 'Delivered') return res.status(400).json({ error: 'Cannot set Delivered milestone directly. Use /verify-delivery endpoint to confirm delivery.' });

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found.' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });

    const status = milestoneMap[milestone];
    const updates = { status, updated_at: new Date().toISOString() };
    let generatedOtp = null;

    if (milestone === 'In Transit' && (!order.delivery_otp || isOtpExpired(order.otp_generated_at))) {
      generatedOtp = Math.floor(100000 + Math.random() * 900000).toString();
      updates.delivery_otp = generatedOtp;
      updates.otp_generated_at = new Date().toISOString();
      clearOtpState(orderId);
    }

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders').update(updates).eq('id', orderId).select('*').single();
    if (updateErr) return res.status(500).json({ error: 'Failed to update order.', details: updateErr.message });

    const { error: timelineErr } = await supabase.from('order_timeline').update({ completed: true, milestone_time: new Date().toISOString() }).eq('order_display_id', order.order_display_id).eq('milestone', milestone);
    if (timelineErr) return res.status(500).json({ error: 'Failed to update order timeline.', details: timelineErr.message });

    const response = { message: 'Milestone updated successfully.', order: updatedOrder, milestone, status };
    if (generatedOtp) response.otp = generatedOtp;

    res.json(response);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 9. VERIFY DELIVERY OTP AND RELEASE FUNDS (DRIVER)
// ============================================================================
router.post('/:id/verify-delivery', authenticate, requireRole(['driver']), verifyDeliveryLimiter, validateParams(paramIdSchema), validateBody(verifyDeliverySchema), async (req, res) => {
  const orderId = req.params.id;
  const { otp } = req.body;

  if (!otp) return res.status(400).json({ error: 'OTP is required for verification.' });

  // Check for active lockout from previous failed attempts
  if (checkOtpLockout(orderId)) {
    return res.status(429).json({
      error: `Too many failed OTP attempts. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
    });
  }

  try {
    const { data: order, error: orderErr } = await supabase.from('orders').select('*').eq('id', orderId).maybeSingle();
    if (orderErr || !order) return res.status(404).json({ error: 'Order not found.' });
    if (order.driver_id !== req.user.id) return res.status(403).json({ error: 'Access Denied: You are not assigned to this order.' });
    if (!order.delivery_otp || order.otp_verified) return res.status(400).json({ error: 'OTP not available or already verified.' });

    // Check OTP expiry
    if (isOtpExpired(order.otp_generated_at)) {
      return res.status(400).json({
        error: 'OTP has expired. Please request a new delivery OTP.',
      });
    }

    if (order.delivery_otp !== String(otp)) {
      recordOtpFailure(orderId);
      const remaining = OTP_MAX_FAILED_ATTEMPTS - (otpFailedAttempts.get(orderId)?.count || 0);
      const message = remaining > 0
        ? `Invalid OTP. ${remaining} attempt(s) remaining before lockout.`
        : `Invalid OTP. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes due to too many failed attempts.`;
      console.warn(`[OTP] Failed verification attempt for order ${orderId} by driver ${req.user.id}. ${remaining} attempts remaining.`);
      return res.status(400).json({ error: message });
    }

    // Successful verification — clear failure state
    clearOtpState(orderId);

    const { data: updatedOrder, error: updateErr } = await supabase.from('orders').update({
      otp_verified: true, status: 'payment_released', updated_at: new Date().toISOString()
    }).eq('id', orderId).select('*').single();

    if (updateErr) return res.status(500).json({ error: 'Failed to verify OTP.', details: updateErr.message });

    await supabase.from('order_timeline').update({ completed: true, milestone_time: new Date().toISOString() }).eq('order_display_id', order.order_display_id).eq('milestone', 'Delivered');

    try {
      const { error: rpcErr } = await supabase.rpc('complete_trip_tx', { p_order_id: orderId });
      if (rpcErr) console.warn('complete_trip_tx RPC not available or failed:', rpcErr.message);
    } catch (rpcErr) {
      console.warn('complete_trip_tx RPC call error:', rpcErr.message);
    }

    res.json({ message: 'Delivery verified successfully! Payment released to driver.', order: updatedOrder });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;