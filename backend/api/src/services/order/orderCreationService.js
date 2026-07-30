import crypto from 'crypto';
import { supabase } from '../../config/db.js';
import { getRouteEstimate } from '../osrm.js';
import { computeOrderPricing } from '../../lib/pricing.js';
import { predictPrice } from '../ml.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
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
    const trafficMultiplier = await getLiveTrafficMultiplier(pickup_lat, pickup_lng);
    
    const mlResult = await predictPrice({
      distanceKm: pricing.distanceKm,
      cargoWeightKg: Number(weight_tonnes) * 1000,
      routeOrigin: pickup_address,
      routeDestination: drop_address,
      trafficMultiplier,
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
    const { data: rpcData, error: rpcErr } = await supabase.rpc('create_order_tx', {
      p_order_display_id: orderDisplayId,
      p_customer_id: userId,
      p_customer_name: user?.fullName || 'Customer',
      p_pickup_address: pickup_address,
      p_pickup_lat: pickup_lat,
      p_pickup_lng: pickup_lng,
      p_drop_address: drop_address,
      p_drop_lat: drop_lat,
      p_drop_lng: drop_lng,
      p_pickup_date: pickup_date,
      p_pickup_time: pickup_time,
      p_goods_type: goods_type,
      p_weight_tonnes: weight_tonnes,
      p_length_ft: length_ft || null,
      p_width_ft: width_ft || null,
      p_height_ft: height_ft || null,
      p_is_stackable: is_stackable,
      p_is_fragile: is_fragile,
      p_special_requirements: special_requirements || null,
      p_base_freight: pricing.baseFreight,
      p_toll_estimate: pricing.tollEstimate,
      p_platform_fee: pricing.platformFee,
      p_total_amount: pricing.totalAmount,
      p_estimated_price: estimatedPrice,
      p_payment_method_id: payment_method_id || null,
      p_upi_id: upi_id || null,
      p_route_label: `${pickup_address.split(',')[0]} → ${drop_address.split(',')[0]}`,
      p_route_subtitle: `${weight_tonnes} tonnes • ${goods_type}`,
      p_weight_text: `${weight_tonnes} tonnes`,
      p_fuel_cost: pricing.fuelCost,
      p_net_profit: pricing.netProfit,
      p_extra_distance_km: pricing.distanceKm
    });

    if (rpcErr) {
      if (rpcErr.code === '23505') {
        logger.warn(`[Orders] display ID collision on ${orderDisplayId}, retrying (attempt ${attempt + 1}/${MAX_ID_RETRIES})`);
        continue;
      }
      logger.error('Order RPC Insertion Error:', rpcErr.message);
      throw new DomainError(500, { error: 'Failed to create order record via transaction.', details: rpcErr.message });
    }

    order = rpcData;
    orderErr = null;
    break;
  }

  if (!order) {
    throw new DomainError(500, { error: 'Failed to generate a unique order display ID after max retries.' });
  }

  try {
    const { sendFcmNotification } = await import('../notificationService.js');
    const { data: drivers } = await supabase
      .from('profiles')
      .select('id, fcm_token')
      .eq('role', 'driver')
      .not('fcm_token', 'is', null);

    if (drivers && drivers.length > 0) {
      const notification = {
        title: 'New Trip Available',
        body: `A new trip from ${pickup_address.split(',')[0]} to ${drop_address.split(',')[0]} is available.`,
      };
      const payload = {
        type: 'new_trip',
        orderId: orderDisplayId,
      };
      // Fire and forget notifications
      Promise.all(drivers.map(driver => sendFcmNotification(driver.id, notification, payload))).catch(e => {
        logger.error('Error in batch push notification:', e.message);
      });
    }
  } catch (pushErr) {
    logger.error('Failed to send push notifications to drivers:', pushErr.message);
  }

  return { message: 'Order created successfully and broadcasted to loads board.', order };
  });
}
