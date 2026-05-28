import express from 'express';
import { supabase } from '../config/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = express.Router();

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
router.post('/', authenticate, requireRole(['customer']), async (req, res) => {
  const {
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    base_freight, toll_estimate, platform_fee, total_amount,
    payment_method_id, upi_id
  } = req.body;

  // Basic validations
  if (!pickup_address || !pickup_lat || !pickup_lng || !drop_address || !drop_lat || !drop_lng || !goods_type || !weight_tonnes) {
    return res.status(400).json({ error: 'Missing required routing or cargo specification fields.' });
  }

  const orderDisplayId = generateOrderDisplayId();

  try {
    // Step 1: Insert into orders table
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
        base_freight, toll_estimate, platform_fee, total_amount,
        payment_method_id, upi_id
      })
      .select('id, order_display_id, status, created_at')
      .single();

    if (orderErr) {
      console.error('Order Insertion Error:', orderErr.message);
      return res.status(500).json({ error: 'Failed to create order record.', details: orderErr.message });
    }

    // Step 2: Initialize Timeline Milestones
    const milestones = [
      { order_display_id: orderDisplayId, milestone: 'Order Placed', milestone_time: new Date().toISOString(), completed: true, sort_order: 10 },
      { order_display_id: orderDisplayId, milestone: 'Truck Assigned', milestone_time: null, completed: false, sort_order: 20 },
      { order_display_id: orderDisplayId, milestone: 'En Route to Pickup', milestone_time: null, completed: false, sort_order: 30 },
      { order_display_id: orderDisplayId, milestone: 'Goods Loaded', milestone_time: null, completed: false, sort_order: 40 },
      { order_display_id: orderDisplayId, milestone: 'In Transit', milestone_time: null, completed: false, sort_order: 50 },
      { order_display_id: orderDisplayId, milestone: 'Delivered', milestone_time: null, completed: false, sort_order: 60 }
    ];

    const { error: timelineErr } = await supabase
      .from('order_timeline')
      .insert(milestones);

    if (timelineErr) {
      console.error('Timeline Insertion Error:', timelineErr.message);
      // We don't fail the whole request since order is created, but log it
    }

    // Step 3: Automatically expose this order as a "load_offer" for drivers
    // In a production system, this could also be populated via database triggers.
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
        freight_value: base_freight,
        fuel_cost: Math.round(base_freight * 0.45), // Mock calculation
        toll_cost: toll_estimate || 0,
        net_profit: Math.round(base_freight * 0.55) - (toll_estimate || 0),
        status: 'available'
      });

    if (offerErr) {
      console.error('Load Offer Insertion Error:', offerErr.message);
    }

    res.status(201).json({
      message: 'Order created successfully and broadcasted to loads board.',
      order
    });

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

    if (error) {
      return res.status(500).json({ error: 'Failed to fetch history.', details: error.message });
    }

    res.json(history);
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 3. FETCH SPECIFIC ORDER DETAILS AND TIMELINE (CUSTOMER OR DRIVER)
// ============================================================================
router.get('/:id', authenticate, async (req, res) => {
  const orderId = req.params.id;

  try {
    // 3.1 Fetch Order detail
    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr) {
      return res.status(500).json({ error: 'Query failed.', details: orderErr.message });
    }

    if (!order) {
      return res.status(404).json({ error: 'Order not found.' });
    }

    // Security check: Make sure user owns this order or is the assigned driver
    if (order.customer_id !== req.user.id && order.driver_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    // 3.2 Fetch timeline
    const { data: timeline, error: timelineErr } = await supabase
      .from('order_timeline')
      .select('milestone, milestone_time, completed, sort_order')
      .eq('order_display_id', order.order_display_id)
      .order('sort_order', { ascending: true });

    // 3.3 Fetch driver details if assigned (Logical application join)
    let driverProfile = null;
    if (order.driver_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, avatar_url')
        .eq('id', order.driver_id)
        .maybeSingle();

      const { data: details } = await supabase
        .from('driver_details')
        .select('rating, total_trips')
        .eq('user_id', order.driver_id)
        .maybeSingle();

      if (profile && details) {
        driverProfile = {
          name: profile.full_name,
          phone: profile.phone,
          avatar: profile.avatar_url,
          rating: details.rating,
          trips: details.total_trips
        };
      }
    }

    res.json({
      order,
      timeline: timeline || [],
      driver: driverProfile
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ============================================================================
// 4. SUBMIT BID FOR LOAD OFFER (DRIVER)
// ============================================================================
router.post('/:id/bids', authenticate, requireRole(['driver']), async (req, res) => {
  const loadOfferId = req.params.id; // load_offers.id
  const { bid_amount } = req.body; // in paisa

  if (!bid_amount || bid_amount <= 0) {
    return res.status(400).json({ error: 'Invalid bid amount.' });
  }

  try {
    // Check if the load exists and is still available
    const { data: offer, error: offerErr } = await supabase
      .from('load_offers')
      .select('id, status')
      .eq('id', loadOfferId)
      .maybeSingle();

    if (offerErr || !offer) {
      return res.status(404).json({ error: 'Load offer not found.' });
    }

    if (offer.status !== 'available') {
      return res.status(410).json({ error: 'Load is no longer available for bidding.' });
    }

    // Submit bid
    const { data: bid, error: bidErr } = await supabase
      .from('load_bids')
      .insert({
        load_id: loadOfferId,
        driver_id: req.user.id,
        bid_amount,
        status: 'pending'
      })
      .select('*')
      .single();

    if (bidErr) {
      return res.status(500).json({ error: 'Failed to record bid.', details: bidErr.message });
    }

    res.status(201).json({
      message: 'Bid submitted successfully.',
      bid
    });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error.' });
  }
});

// ============================================================================
// 5. VIEW BIDS FOR AN ORDER (CUSTOMER)
// ============================================================================
router.get('/:id/bids', authenticate, requireRole(['customer']), async (req, res) => {
  const orderId = req.params.id;

  try {
    // Find matching load offer display id from the order
    const { data: order } = await supabase
      .from('orders')
      .select('order_display_id, customer_id')
      .eq('id', orderId)
      .maybeSingle();

    if (!order || order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    // Find the load offer
    const { data: offer } = await supabase
      .from('load_offers')
      .select('id')
      .eq('order_display_id', order.order_display_id)
      .maybeSingle();

    if (!offer) {
      return res.json([]); // No load offer created yet
    }

    // Fetch active bids and join driver profiles at app layer (independent tables join)
    const { data: bids, error: bidErr } = await supabase
      .from('load_bids')
      .select('*')
      .eq('load_id', offer.id)
      .eq('status', 'pending')
      .order('bid_amount', { ascending: true });

    if (bidErr) {
      return res.status(500).json({ error: 'Query failed.', details: bidErr.message });
    }

    if (!bids || bids.length === 0) {
      return res.json([]);
    }

    // Populate profile and truck data
    // Batch fetch all driver IDs at once
    const driverIds = bids.map(b => b.driver_id);

    const [profilesRes, detailsRes] = await Promise.all([
      supabase
        .from('profiles')
        .select('id, full_name, avatar_url, phone')
        .in('id', driverIds),
      supabase
        .from('driver_details')
        .select('user_id, rating, total_trips, completion_rate, truck_id')
        .in('user_id', driverIds)
    ]);

    const profiles = profilesRes.data || [];
    const details  = detailsRes.data || [];

    // Batch fetch all trucks
    const truckIds = details
      .map(d => d.truck_id)
      .filter(Boolean);

    const trucksRes = truckIds.length > 0
      ? await supabase
          .from('trucks')
          .select('id, name, number_plate')
          .in('id', truckIds)
      : { data: [] };

    const trucks = trucksRes.data || [];

    // Map into lookup objects
    const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
    const detailMap  = Object.fromEntries(details.map(d => [d.user_id, d]));
    const truckMap   = Object.fromEntries(trucks.map(t => [t.id, t]));

    const enrichedBids = bids.map(bid => {
      const profile = profileMap[bid.driver_id] || {};
      const detail  = detailMap[bid.driver_id]  || {};
      const truck   = detail.truck_id ? truckMap[detail.truck_id] : null;

      return {
        id:         bid.id,
        bid_amount: bid.bid_amount,
        created_at: bid.created_at,
        driver: {
          id:              bid.driver_id,
          name:            profile.full_name       || 'Anonymous Driver',
          avatar:          profile.avatar_url,
          phone:           profile.phone,
          rating:          detail.rating           || 0.00,
          trips:           detail.total_trips      || 0,
          completion_rate: detail.completion_rate  || 100.00
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
// 6. ACCEPT BID (CUSTOMER)
// ============================================================================
router.post('/:id/bids/:bidId/accept', authenticate, requireRole(['customer']), async (req, res) => {
  const orderId = req.params.id;
  const bidId = req.params.bidId;

  try {
    // 6.1 Verify order ownership
    const { data: order } = await supabase
      .from('orders')
      .select('order_display_id, customer_id')
      .eq('id', orderId)
      .maybeSingle();

    if (!order || order.customer_id !== req.user.id) {
      return res.status(403).json({ error: 'Access Denied: You do not own this order.' });
    }

    // 6.2 Fetch bid details
    const { data: bid } = await supabase
      .from('load_bids')
      .select('*')
      .eq('id', bidId)
      .maybeSingle();

    if (!bid || bid.status !== 'pending') {
      return res.status(404).json({ error: 'Bid is not active or not found.' });
    }

    // 6.3 Fetch driver details & truck details for denormalized snapshot storage
    const { data: profile } = await supabase
      .from('profiles')
      .select('full_name')
      .eq('id', bid.driver_id)
      .maybeSingle();

    const { data: details } = await supabase
      .from('driver_details')
      .select('rating, truck_id')
      .eq('user_id', bid.driver_id)
      .maybeSingle();

    let truckInfo = null;
    if (details && details.truck_id) {
      truckInfo = await supabase
        .from('trucks')
        .select('id, name, number_plate')
        .eq('id', details.truck_id)
        .maybeSingle()
        .then(res => res.data);
    }

    // 6.4 Execute atomically via Supabase RPC
    const { error: rpcErr } = await supabase.rpc('accept_bid_tx', {
      p_bid_id:           bidId,
      p_order_id:         orderId,
      p_load_id:          bid.load_id,
      p_driver_id:        bid.driver_id,
      p_truck_id:         truckInfo?.id || null,
      p_driver_name:      profile?.full_name || 'Assigned Driver',
      p_driver_rating:    details?.rating || 0.00,
      p_truck_number:     truckInfo?.number_plate || 'N/A',
      p_bid_amount:       bid.bid_amount,
      p_order_display_id: order.order_display_id
    });

    if (rpcErr) {
      return res.status(500).json({
        error: 'Failed to accept bid atomically.',
        details: rpcErr.message
      });
    }

    res.json({ message: 'Bid accepted. Driver and truck assigned.' });

  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

export default router;
