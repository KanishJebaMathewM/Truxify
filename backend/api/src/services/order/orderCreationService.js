import crypto from 'crypto';
import { supabase } from '../../config/db.js';
import { getRouteEstimate } from '../osrm.js';
import { computeOrderPricing } from '../../lib/pricing.js';
import { predictPrice } from '../ml.js';
import { DomainError } from './bidAcceptanceService.js';
import logger from '../../middleware/logger.js';
import { measureExecution } from '../../core/performanceMetrics.js';

function generateOrderDisplayId() {
  const prefix = '#FF';
  const now = new Date();
  const dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  const random = crypto.randomInt(100000, 999999).toString();
  return `${prefix}${dateStr}${random}`;
}

export async function createOrder({ orderData, userId, user }) {
  return measureExecution('OrderCreationService.createOrder', async () => {
  const {
    pickup_address, pickup_lat, pickup_lng,
    drop_address, drop_lat, drop_lng,
    pickup_date, pickup_time,
    goods_type, weight_tonnes, length_ft, width_ft, height_ft,
    is_stackable, is_fragile, special_requirements,
    payment_method_id, upi_id
  } = orderData;

  if (!pickup_address || pickup_lat == null || pickup_lng == null || !drop_address || drop_lat == null || drop_lng == null || !goods_type || weight_tonnes == null) {
    throw new DomainError(400, { error: 'Missing required routing or cargo specification fields.' });
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
    throw new DomainError(400, {
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

  for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
    orderDisplayId = generateOrderDisplayId();
    const result = await supabase
      .from('orders')
      .insert({
        order_display_id: orderDisplayId,
        customer_id: userId,
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
    throw new DomainError(500, { error: 'Failed to create order record.', details: orderErr.message });
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
    await supabase.from('orders').delete().eq('id', order.id);
    throw new DomainError(500, { error: 'Failed to create order timeline.', details: timelineErr.message });
  }

  const { error: offerErr } = await supabase
    .from('load_offers')
    .insert({
      order_display_id: orderDisplayId,
      customer_id: userId,
      customer_name: user?.fullName || 'Customer',
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
    await supabase.from('order_timeline').delete().eq('order_display_id', orderDisplayId);
    await supabase.from('orders').delete().eq('id', order.id);
    throw new DomainError(500, { error: 'Failed to create load offer.', details: offerErr.message });
  }

  return { message: 'Order created successfully and broadcasted to loads board.', order };
  });
}
