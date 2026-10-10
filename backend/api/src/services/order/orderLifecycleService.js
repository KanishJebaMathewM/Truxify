import { DomainError } from './domainError.js';
import { DeliveryVerificationService } from './deliveryVerificationService.js';
import { formatPaginationMeta } from '../../utils/pagination.js';
import { expireDeliveryOtps, sendPushNotification } from '../notificationService.js';
import { acquireLock, releaseLock } from '../../lib/redisLock.js';
import { acquireLockOrFallback } from '../../lib/lockFallback.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { createHash } from 'crypto';
import { supabase, supabaseAdmin } from '../../config/db.js';
import {
  submitEscrowRefund,
  recordDepositTx,
  submitEscrowCancelWithPenalty,
  confirmEscrowRefund,
  getEscrowBookingId,
  resolveExpectedDepositAmount,
  paisaToMaticWei,
  updateEscrowDropAmount,
} from '../escrow.js';
import { computeOrderPricing } from '../../lib/pricing.js';
import { getRouteEstimate } from '../osrm.js';
import { optimizeWaypoints } from '../routingService.js';
import { predictPrice } from '../ml.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
import { eventBus } from '../../core/events/index.js';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';
import { SagaCoordinator } from '../../core/saga/index.js';

const osrmCircuitBreaker = new CircuitBreaker('osrmRouting', {
  failureThreshold: 3,
  resetTimeoutMs: 15000,
  requestTimeoutMs: 5000,
});

const mlPriceCircuitBreaker = new CircuitBreaker('mlPricePrediction', {
  failureThreshold: 3,
  resetTimeoutMs: 15000,
  requestTimeoutMs: 5000,
});
import { generateOrderDisplayId, ORDER_DISPLAY_ID_MAX_RETRIES } from '../../lib/orderDisplayId.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ORDER_DETAIL_FIELDS = [
  'id',
  'order_display_id',
  'customer_id',
  'driver_id',
  'truck_id',
  'status',
  'pickup_address',
  'pickup_lat',
  'pickup_lng',
  'drop_address',
  'drop_lat',
  'drop_lng',
  'pickup_date',
  'pickup_time',
  'goods_type',
  'weight_tonnes',
  'length_ft',
  'width_ft',
  'height_ft',
  'is_stackable',
  'is_fragile',
  'special_requirements',
  'total_amount',
  'cancellation_fee',
  'cancellation_reason',
  'driver_name',
  'driver_rating',
  'truck_number',
  'eta',
  'waypoints',
  'created_at',
  'updated_at',
].join(', ');

export class OrderLifecycleService {
  constructor({
    orderRepository,
    orderTimelineService,
    bidAcceptanceService,
    deliveryVerificationService,
    trackingTokenService,
    sagaCoordinatorFactory,
    sagaPersister,
  }) {
    this.orderRepository = orderRepository;
    this.orderTimelineService = orderTimelineService;
    this.bidAcceptanceService = bidAcceptanceService;
    this.deliveryVerification = deliveryVerificationService || new DeliveryVerificationService(orderRepository);
    this.trackingTokenService = trackingTokenService || null;
    this.sagaCoordinatorFactory = sagaCoordinatorFactory || ((options) => new SagaCoordinator(options));
    this.sagaPersister = sagaPersister || null;
  }

  async revokeTrackingTokensForOrder(orderDisplayId) {
    if (!this.trackingTokenService || !orderDisplayId) return;
    try {
      await this.trackingTokenService.revokeAllForOrder(orderDisplayId);
    } catch (error) {
      logger.error(`[OrderLifecycleService] Failed to revoke tracking tokens for order ${orderDisplayId}:`, error);
    }
  }

  async createOrder(customerId, customerName, body, idempotencyKey = null) {
    return measureExecution('OrderLifecycleService.createOrder', async () => {
      const {
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        pickup_date, pickup_time,
        goods_type, weight_tonnes, length_ft, width_ft, height_ft,
        is_stackable, is_fragile, special_requirements,
        payment_method_id, upi_id,
        waypoints = [],
      } = body;

      const optimizedWaypoints = await optimizeWaypoints(
        { lat: Number(pickup_lat), lng: Number(pickup_lng), address: pickup_address },
        { lat: Number(drop_lat), lng: Number(drop_lng), address: drop_address },
        waypoints,
        pickup_date,
        pickup_time
      );

      let pricing;
      try {
        const routeEstimate = await osrmCircuitBreaker.execute((options = {}) => getRouteEstimate({
          pickupLat: Number(pickup_lat),
          pickupLng: Number(pickup_lng),
          dropLat: Number(drop_lat),
          dropLng: Number(drop_lng),
          signal: options?.signal,
        }));
        pricing = computeOrderPricing({
          pickupLat: Number(pickup_lat),
          pickupLng: Number(pickup_lng),
          dropLat: Number(drop_lat),
          dropLng: Number(drop_lng),
          weightTonnes: Number(weight_tonnes),
          roadDistanceKm: routeEstimate?.distanceKm,
          isFragile: Boolean(is_fragile),
          isStackable: Boolean(is_stackable),
        });
      } catch (pricingErr) {
        throw new DomainError(400, {
          error: 'Unable to compute freight pricing for the given route/cargo.',
          details: pricingErr.message,
        });
      }

      let finalBaseFreight = pricing.baseFreight;
      let finalTollEstimate = pricing.tollEstimate;
      let finalPlatformFee = pricing.platformFee;
      let finalTotalAmount = pricing.totalAmount;
      let estimatedPrice = null;

      try {
        const trafficMultiplier = await getLiveTrafficMultiplier(pickup_lat, pickup_lng);

        const mlResult = await mlPriceCircuitBreaker.execute((options = {}) => predictPrice({
          distanceKm: pricing.distanceKm,
          cargoWeightKg: Number(weight_tonnes) * 1000,
          truckType: 'medium_truck',
          routeOrigin: pickup_address,
          routeDestination: drop_address,
          trafficMultiplier,
          signal: options?.signal,
        }));
        if (mlResult && mlResult.estimatedPricePaisa > 0) {
          estimatedPrice = mlResult.estimatedPricePaisa;
          finalTotalAmount = mlResult.estimatedPricePaisa;
          finalPlatformFee = Math.round(mlResult.estimatedPricePaisa * 0.05);
          finalBaseFreight = Math.max(0, mlResult.estimatedPricePaisa - finalPlatformFee - finalTollEstimate);
          if (finalBaseFreight === 0) {
            finalTollEstimate = Math.max(0, mlResult.estimatedPricePaisa - finalPlatformFee);
          }
        }
      } catch (mlErr) {
        logger.warn({ err: mlErr.message }, 'Price prediction unavailable, falling back to base pricing');
      }

      // Atomic, idempotent creation: create_order_tx inserts the order, its
      // default timeline, and the load offer in ONE transaction (#11434), and
      // honors the X-Idempotency-Key claim with a request fingerprint (#7135).
      // This was silently reverted to separate inserts by ea533a2f92 (an
      // unrelated ML commit) — restored from the orderCreationService
      // implementation, which still carries the correct RPC contract.
      const fingerprint = createHash('sha256')
        .update(`${customerId}:${JSON.stringify(body ?? {})}`)
        .digest('hex');

      const MAX_ID_RETRIES = ORDER_DISPLAY_ID_MAX_RETRIES;
      let order = null;
      let orderDisplayId = null;

      for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
        orderDisplayId = generateOrderDisplayId();
        const { data: rpcData, error: rpcErr } = await (supabaseAdmin ?? supabase).rpc('create_order_tx', {
          p_order_display_id: orderDisplayId,
          p_customer_id: customerId,
          p_customer_name: customerName || 'Customer',
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
          p_base_freight: finalBaseFreight,
          p_toll_estimate: finalTollEstimate,
          p_platform_fee: finalPlatformFee,
          p_total_amount: finalTotalAmount,
          p_estimated_price: estimatedPrice,
          p_payment_method_id: payment_method_id || null,
          p_upi_id: upi_id || null,
          p_route_label: `${pickup_address.split(',')[0]} → ${drop_address.split(',')[0]}`,
          p_route_subtitle: `${weight_tonnes} tonnes • ${goods_type}`,
          p_weight_text: `${weight_tonnes} tonnes`,
          p_fuel_cost: pricing.fuelCost,
          p_net_profit: pricing.netProfit,
          p_extra_distance_km: pricing.distanceKm,
          p_idempotency_key: idempotencyKey,
          p_request_fingerprint: fingerprint
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
        break;
      }

      if (!order) {
        throw new DomainError(500, { error: 'Failed to generate a unique order display ID after max retries.' });
      }

      // Durable idempotency discriminator (#7135): create_order_tx returns
      // idempotent=true for every path taken while a key was supplied.
      if (order.idempotent === true) {
        if (order.outcome === 'conflict') {
          throw new DomainError(409, { error: 'Idempotency key has already been used for a different request.' });
        }
        if (order.outcome === 'in_progress') {
          throw new DomainError(409, { error: 'Duplicate request being processed' });
        }
        if (order.outcome === 'replayed') {
          return { order: order.response.order };
        }
        if (order.outcome !== 'created') {
          throw new DomainError(500, { error: `Unexpected idempotency outcome: ${order.outcome}` });
        }
        order = order.response.order;
      }

      return { order };
    });
  }

  async getActiveOrders(customerId) {
    return measureExecution('OrderLifecycleService.getActiveOrders', async () => {
      const activeStatuses = ['pending', 'active', 'truck_assigned', 'en_route_pickup', 'arrived_pickup', 'picked_up', 'in_transit', 'arriving'];

      const { data: orders, error } = await this.orderRepository.findOrdersByCustomer(
        customerId, '*', activeStatuses, 'pickup_date', false
      );

      if (error) throw new DomainError(500, { error: 'Failed to fetch active orders.', details: error.message });

      const driverIds = [...new Set(orders.filter(o => o.driver_id).map(o => o.driver_id))];
      if (driverIds.length > 0) {
        const { data: profiles } = await this.orderRepository.findProfilesByIds(driverIds);
        const driverMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
        orders.forEach(o => { o.driver_name = driverMap[o.driver_id] || 'Driver Assigned'; });
      }

      return orders;
    });
  }

  async getOrderHistory(customerId, page, limit) {
    return measureExecution('OrderLifecycleService.getOrderHistory', async () => {
      const { data: history, error, count } = await this.orderRepository.findOrdersWithCount(
        customerId,
        'id, order_display_id, status, pickup_address, pickup_lat, pickup_lng, drop_address, drop_lat, drop_lng, pickup_date, total_amount, goods_type, weight_tonnes, length_ft, width_ft, height_ft, is_stackable, is_fragile, special_requirements, driver_id, eta, truck_number, created_at',
        { page, limit }
      );

      if (error) throw new DomainError(500, { error: 'Failed to fetch history.', details: error.message });

      const driverIds = [...new Set((history || []).filter(o => o.driver_id).map(o => o.driver_id))];
      if (driverIds.length > 0) {
        const { data: profiles } = await this.orderRepository.findProfilesByIds(driverIds);
        const driverMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
        (history || []).forEach(o => { o.driver_name = driverMap[o.driver_id] || 'Driver Assigned'; });
      }

      try {
        const { data: ratings } = await this.orderRepository.findRatingsForCustomer(customerId);
        const ratingMap = Object.fromEntries((ratings || []).map(r => [r.order_display_id, r.stars]));
        (history || []).forEach(o => {
          o.rating_given = ratingMap[o.order_display_id] || null;
        });
      } catch (err) {
        logger.error("[orderLifecycleService] Failed to map ratings:", err.message);
      }

      const pagination = formatPaginationMeta(count || 0, page, limit);

      return {
        page: pagination.page,
        limit: pagination.limit,
        total: pagination.total,
        totalPages: pagination.totalPages,
        history: history || [],
        data: history || [],
        pagination
      };
    });
  }

  async getOrderDetail(orderId, userId) {
    return measureExecution('OrderLifecycleService.getOrderDetail', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderByAnyId(orderId, ORDER_DETAIL_FIELDS);
      if (orderErr) throw new DomainError(500, { error: 'Query failed.', details: orderErr.message });
      if (!order) throw new DomainError(404, { error: 'Order not found.' });

      if (order.customer_id !== userId && order.driver_id !== userId) {
        throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
      }

      const { data: timeline } = await this.orderTimelineService.getTimeline(order.order_display_id);

      let driverProfile = null;
      if (order.driver_id) {
        const [{ data: profile }, { data: details }] = await Promise.all([
          this.orderRepository.findProfile(order.driver_id),
          this.orderRepository.findDriverDetail(order.driver_id),
        ]);

        if (profile && details) {
          driverProfile = {
            name: profile.full_name,
            phone: profile.phone,
            avatar: profile.avatar_url,
            rating: details.rating,
            trips: details.total_trips,
          };
        }
      }

      return { order, timeline: timeline || [], driver: driverProfile };
    });
  }

  async getOrderTimeline(orderId, userId) {
    return measureExecution('OrderLifecycleService.getOrderTimeline', async () => {
      let order;
      if (UUID_RE.test(orderId)) {
        const { data } = await this.orderRepository.findOrderById(orderId, 'customer_id, driver_id, order_display_id');
        order = data;
      }
      if (!order) {
        const { data } = await this.orderRepository.findOrderByDisplayId(orderId, 'customer_id, driver_id, order_display_id');
        order = data;
      }

      if (!order) throw new DomainError(404, { error: 'Order not found.' });

      if (order.customer_id !== userId && order.driver_id !== userId) {
        throw new DomainError(403, { error: 'Access Denied: You do not own or are not assigned to this order.' });
      }

      const { data: timeline, error: timelineErr } = await this.orderTimelineService.getTimeline(order.order_display_id);

      if (timelineErr) throw new DomainError(500, { error: 'Failed to fetch timeline.', details: timelineErr.message });
      return timeline || [];
    });
  }

  async submitBid(loadOfferId, driverId, bidAmount) {
    return measureExecution('OrderLifecycleService.submitBid', async () => {
      const lockKey = `lock:submitBid:${driverId}:${loadOfferId}`;
      const lockValue = await acquireLock(lockKey, 5000);
      if (!lockValue) throw new DomainError(409, { error: 'Duplicate bid submission in progress.' });

      try {
        const { data: offer, error: offerErr } = await this.orderRepository.findLoadOfferById(loadOfferId, 'id, status, customer_id');
        if (offerErr || !offer) throw new DomainError(404, { error: 'Load offer not found.' });
        if (offer.status !== 'available') throw new DomainError(410, { error: 'Load is no longer available for bidding.' });
        if (offer.customer_id === driverId) throw new DomainError(403, { error: 'You cannot bid on your own load offer' });

        const { data: driverDetails, error: driverDetailsErr } = await this.orderRepository.findDriverDetailMinimal(driverId);
        if (driverDetailsErr) throw new DomainError(500, { error: 'Failed to verify driver profile.', details: driverDetailsErr.message });
        if (!driverDetails?.truck_id) throw new DomainError(400, { error: 'You must assign a valid truck to your profile before bidding on loads' });

        const { data: truck, error: truckErr } = await this.orderRepository.findTruckById(driverDetails.truck_id);
        if (truckErr) throw new DomainError(500, { error: 'Failed to verify assigned truck.', details: truckErr.message });
        if (!truck) throw new DomainError(400, { error: 'Assigned truck record could not be found' });

        const { data: existingBid, error: existingBidErr } = await this.orderRepository.findExistingBid(loadOfferId, driverId, 'pending');
        if (existingBidErr) throw new DomainError(500, { error: 'Failed to verify existing bids.', details: existingBidErr.message });
        if (existingBid) throw new DomainError(409, { error: 'You already have a pending bid for this load.' });

        const { data: bid, error: bidErr } = await this.orderRepository.createBid({
          load_id: loadOfferId,
          driver_id: driverId,
          bid_amount: bidAmount,
          status: 'pending',
        });

        if (bidErr) throw new DomainError(500, { error: 'Failed to record bid.', details: bidErr.message });

        sendPushNotification(
          offer.customer_id,
          'New Bid Received',
          `A driver has submitted a bid of ₹${(bidAmount / 100).toFixed(2)} for your order.`,
          'order_update',
          { loadOfferId, bidId: bid.id }
        ).catch(err => logger.error(`[FCM] Failed to notify customer of new bid: ${err.message}`));

        return { message: 'Bid submitted successfully.', bid };
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    });
  }

  async getBidsForOrder(orderId, customerId) {
    return measureExecution('OrderLifecycleService.getBidsForOrder', async () => {
      const { data: order } = await this.orderRepository.findOrderById(orderId, 'order_display_id, customer_id');
      if (!order || order.customer_id !== customerId) throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });

      const { data: offer } = await this.orderRepository.findLoadOfferByOrderDisplayId(order.order_display_id);
      if (!offer) return [];

      const { data: bids, error: bidErr } = await this.orderRepository.findBidsByLoad(offer.id, 'pending', { orderBy: 'bid_amount', ascending: true });
      if (bidErr) throw new DomainError(500, { error: 'Query failed.', details: bidErr.message });
      if (!bids || bids.length === 0) return [];

      const driverIds = bids.map(b => b.driver_id);
      const [profilesRes, detailsRes] = await Promise.all([
        this.orderRepository.findProfilesByIds(driverIds, 'id, full_name, avatar_url, phone'),
        this.orderRepository.findDriverDetails(driverIds),
      ]);

      const profiles = profilesRes.data || [];
      const details = detailsRes.data || [];
      const truckIds = details.map(d => d.truck_id).filter(Boolean);
      const trucksRes = truckIds.length > 0 ? await this.orderRepository.findTrucksByIds(truckIds) : { data: [] };
      const trucks = trucksRes.data || [];

      const profileMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      // Normalize detailMap keys by both user_id and driver_id
      const detailMap = {};
      details.forEach(d => {
        if (d.user_id) detailMap[d.user_id] = d;
        if (d.driver_id && d.driver_id !== d.user_id) detailMap[d.driver_id] = d;
      });
      const truckMap = Object.fromEntries(trucks.map(t => [t.id, t]));

      const enrichedBids = bids.map(bid => {
        const profile = profileMap[bid.driver_id] || {};
        const detail = detailMap[bid.driver_id] || {};
        const truck = detail.truck_id ? truckMap[detail.truck_id] : null;

        return {
          id: bid.id, bid_amount: bid.bid_amount, created_at: bid.created_at,
          driver: {
            id: bid.driver_id, name: profile.full_name || 'Anonymous Driver', avatar: profile.avatar_url, phone: profile.phone,
            rating: detail.rating || 0.00, trips: detail.total_trips || 0, completion_rate: detail.completion_rate || 100.00,
          },
          truck,
        };
      });

      return enrichedBids;
    });
  }

  async acceptBid(orderId, bidId, customerId) {
    return measureExecution('OrderLifecycleService.acceptBid', () =>
      this.bidAcceptanceService.acceptBid({ orderId, bidId, customerId })
    );
  }

 async updateMilestone(orderId, milestone, driverId) {
    if (!orderId) {
        throw new DomainError(400, {
            error: 'orderId is required.',
        });
    }
    const lockKey = `lock:milestone:${orderId}`;
    const lockValue = await acquireLock(lockKey, 10000);
    if (!lockValue) {
      throw new DomainError(409, {
        error: 'Milestone update already in progress for this order. Please try again.',
      });
    }
    return measureExecution('OrderLifecycleService.updateMilestone', async () => {
      try {
        return await this._updateMilestoneInner(orderId, milestone, driverId);
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    });
  }

  async _updateMilestoneInner(orderId, milestone, driverId) {
    return measureExecution('OrderLifecycleService.updateMilestoneInner', async () => {
      const milestoneMap = {
        'Truck Assigned': 'truck_assigned',
        'En Route to Pickup': 'en_route_pickup',
        'Arrived at Pickup': 'arrived_pickup',
        'Goods Loaded': 'picked_up',
        'In Transit': 'in_transit',
        'Arriving': 'arriving',
      };

      const { data: order, error: orderErr } = await this.orderRepository.findOrderById(orderId, '*');
      if (orderErr || !order) throw new DomainError(404, { error: 'Order not found.' });
      if (order.driver_id !== driverId) throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });

      const { data: timeline, error: tlErr } = await this.orderTimelineService.getTimelineWithSortCheck(order.order_display_id);
      if (tlErr) throw new DomainError(500, { error: 'Failed to fetch order timeline.' });

      const canonicalMilestones = new Set([...Object.keys(milestoneMap), 'Order Placed', 'Delivered']);
      const lastCompleted = [...(timeline || [])].reverse().find(t => t.completed && canonicalMilestones.has(t.milestone));
      const lastCompletedSortOrder = lastCompleted ? lastCompleted.sort_order : 10;

      const timelineEntry = (timeline || []).find(t => t.milestone === milestone);
      if (!timelineEntry) throw new DomainError(400, { error: `Milestone "${milestone}" is not part of this order's timeline.` });

      if (timelineEntry.completed) {
        throw new DomainError(409, { error: `Milestone "${milestone}" has already been completed.` });
      }

      const nextExpected = (timeline || []).find(t => !t.completed && t.sort_order > lastCompletedSortOrder);
      if (!nextExpected || nextExpected.sort_order !== timelineEntry.sort_order) {
        throw new DomainError(422, {
          error: `Milestone out of sequence. Expected "${nextExpected ? nextExpected.milestone : 'none'}" before "${milestone}".`,
        });
      }

      const status = milestoneMap[milestone];
      if (status === undefined) {
        throw new DomainError(400, {
          error: `Milestone "${milestone}" does not map to an order status. Use the delivery verification endpoint instead.`,
        });
      }
      let generatedOtp = null;

      if (milestone === 'In Transit') {
        const result = await this.deliveryVerification.generateDeliveryOtp({ orderId });
        generatedOtp = result.otp;
      }

      const { error: timelineErr } = await this.orderTimelineService.markMilestoneCompleted(order.order_display_id, milestone);
      if (timelineErr) throw new DomainError(500, { error: 'Failed to update order timeline.', details: timelineErr.message });

      const { data: updatedRows, error: updateErr } = await this.orderRepository.executeRpc(
        'update_order_status_tx',
        {
          p_order_id: orderId,
          p_status: status,
          p_event_type: 'ORDER_UPDATED',
          p_payload_extra: { milestone, order_display_id: order.order_display_id },
        },
        supabaseAdmin
      );

      if (updateErr || !updatedRows || updatedRows.length === 0) {
        await this.orderTimelineService.rollbackMilestone(order.order_display_id, milestone);
        throw new DomainError(500, {
          error: 'Failed to update order.',
          details: updateErr?.message ?? 'Order status guard rejected the milestone update.',
        });
      }

      const updatedOrder = updatedRows[0];

      if (generatedOtp) {
        await this.deliveryVerification.sendOtpNotification({
          orderId,
          customerId: order.customer_id,
          orderDisplayId: order.order_display_id,
          otp: generatedOtp,
        });
      }

      sendPushNotification(
        order.customer_id,
        'Order Update',
        `Order ${order.order_display_id} is now: ${milestone}`,
        'order_update',
        { orderId, orderDisplayId: order.order_display_id, milestone }
      ).catch(err => logger.error(`[FCM] Failed to notify customer of order update: ${err.message}`));

      return { order: updatedOrder, milestone, status };
    });
  }

  async verifyDeliveryFn(orderId, driverId, otp, userClient) {
    return measureExecution('OrderLifecycleService.verifyDeliveryFn', async () => {
      if (String(otp).trim() === '123456') {
        throw new DomainError(400, { error: 'Invalid delivery OTP provided.' });
      }
      const lockKey = `escrow_lock:${orderId}`;
      const lock = await acquireLockOrFallback(lockKey, 120000);
      if (!lock.ok) {
        throw new DomainError(409, { error: 'Delivery verification is currently being processed. Please try again later.' });
      }

      try {
        return await this.deliveryVerification.verifyDelivery({ orderId, driverId, otp }, userClient);
      } finally {
        await lock.release();
      }
    });
  }

  async resendOtpFn(orderId, driverId) {
    return measureExecution('OrderLifecycleService.resendOtpFn', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderById(orderId, 'id, order_display_id, driver_id, customer_id, status');
      if (orderErr || !order) throw new DomainError(404, { error: 'Order not found.' });
      if (order.driver_id !== driverId) throw new DomainError(403, { error: 'Access Denied: You are not assigned to this order.' });

      const { expiresInMinutes } = await this.deliveryVerification.resendDeliveryOtp({
        orderId,
        customerId: order.customer_id,
        orderDisplayId: order.order_display_id,
        orderStatus: order.status,
      });

      return { expiresInMinutes };
    });
  }

  async changeDrop(orderId, customerId, body, userClient) {
    return measureExecution('OrderLifecycleService.changeDrop', async () => {
      const { drop_address, drop_lat, drop_lng } = body;

      const { data: initialOrder, error: orderErr } = await this.orderRepository.findOrderByAnyId(orderId, 'id');
      if (orderErr) throw new DomainError(500, { error: 'Failed to fetch order.', details: orderErr.message });
      if (!initialOrder) throw new DomainError(404, { error: 'Order not found.' });

      const lockKey = `escrow_lock:${initialOrder.id}`;
      const lock = await acquireLockOrFallback(lockKey, 30000);
      if (!lock.ok) {
        throw new DomainError(409, { error: 'Order is currently being processed. Please try again later.' });
      }

      try {
        const { data: order, error: refetchErr } = await this.orderRepository.findOrderById(initialOrder.id, '*');
        if (refetchErr) throw new DomainError(500, { error: 'Failed to fetch order.', details: refetchErr.message });
        if (!order) throw new DomainError(404, { error: 'Order not found.' });

        if (order.customer_id !== customerId) throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
        const escrowInFlight = order.escrow_status === 'funding' || order.escrow_status === 'funded';
        if (escrowInFlight || order.status !== 'pending') {
          const reason = escrowInFlight
            ? `after escrow ${order.escrow_status === 'funding' ? 'funding has been initiated' : 'has been funded'}`
            : `after order status is '${order.status}'`;
          throw new DomainError(409, {
            error: `Drop location cannot be changed ${reason}.`,
            recovery: 'Cancel this order to receive a refund, then rebook with the correct destination.',
          });
        }
        if (order.weight_tonnes == null) throw new DomainError(500, { error: 'Data inconsistency: Order is missing weight_tonnes.' });

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
          throw new DomainError(400, { error: 'Unable to compute new pricing for the requested drop.', details: pricingErr.message });
        }

        // Rebalance the escrow booking alongside the re-priced total so the
        // displayed price, the on-chain payout, and any refund all stay in
        // sync. escrow_amount_wei is the authoritative payout figure (verified
        // against at deposit time and on release), so it must track
        // total_amount using the same canonical paisa→wei conversion the rest
        // of the escrow pipeline uses.
        const newAmountWei = BigInt(paisaToMaticWei(pricing.totalAmount));

        if (order.escrow_booking_id && order.escrow_amount_wei != null) {
          const previousAmountWei = BigInt(order.escrow_amount_wei);
          const topUpWei = newAmountWei > previousAmountWei
            ? newAmountWei - previousAmountWei
            : 0n;
          const escrowUpdate = await updateEscrowDropAmount(
            order.order_display_id,
            newAmountWei,
            topUpWei,
          );
          if (escrowUpdate.error || !escrowUpdate.txHash) {
            throw new DomainError(502, {
              error: 'Unable to update the on-chain escrow amount for this drop change.',
              details: escrowUpdate.error || 'Escrow update was not confirmed.',
            });
          }
        }

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
          route_label: `${(order.pickup_address || '').split(',')[0]} \u2192 ${drop_address.split(',')[0]}`,
          freight_value: pricing.totalAmount,
          fuel_cost: pricing.fuelCost,
          toll_cost: pricing.tollEstimate,
          net_profit: pricing.netProfit,
          extra_distance_km: pricing.distanceKm,
        };

        const { data: updatedOrder, error: updateErr } = await this.orderRepository.executeRpc('update_order_and_load_offer', {
          p_order_id: order.id,
          p_order_display_id: order.order_display_id,
          p_order_updates: updates,
          p_offer_updates: offerUpdates
        }, supabaseAdmin);

        if (updateErr) {
          throw new DomainError(500, {
            error: 'Failed to update order and load offer atomically after drop change.',
            details: updateErr.message,
          });
        }

        try {
          await this.orderTimelineService.insertEntry(order.order_display_id, 'Drop Changed', 25);
        } catch (timelineErr) {
          logger.warn('Failed to update timeline for change-drop:', timelineErr.message);
        }

        await expireDeliveryOtps(order.id);

        return {
          message: 'Drop location updated successfully.',
          pricing: {
            base_freight: updatedOrder.base_freight ?? pricing.baseFreight,
            toll_estimate: updatedOrder.toll_estimate ?? pricing.tollEstimate,
            platform_fee: updatedOrder.platform_fee ?? pricing.platformFee,
            total_amount: updatedOrder.total_amount ?? pricing.totalAmount,
          },
          order: updatedOrder,
        };
      } finally {
        await lock.release();
      }
    });
  }

  async cancelOrder(orderId, customerId, reason, userClient) {
    return measureExecution('OrderLifecycleService.cancelOrder', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderByAnyId(orderId, '*');
      if (orderErr) throw new DomainError(500, { error: 'Failed to fetch order.', details: orderErr.message });
      if (!order) throw new DomainError(404, { error: 'Order not found.' });
      if (order.customer_id !== customerId) throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });

      const lockKey = `escrow_lock:${order.id}`;
      const lock = await acquireLockOrFallback(lockKey, 30000);
      if (!lock.ok) {
        throw new DomainError(409, { error: 'Cancellation is currently being processed. Please try again later.' });
      }

      try {
        // Re-fetch order state after acquiring lock to prevent TOCTOU race conditions
        const { data: currentOrder, error: currentOrderErr } = await this.orderRepository.findOrderByAnyId(orderId, '*');
        if (currentOrderErr) throw new DomainError(500, { error: 'Failed to fetch order.', details: currentOrderErr.message });
        if (!currentOrder) throw new DomainError(404, { error: 'Order not found.' });

        // Runs under the caller's identity so RLS resolves get_profile_id() to
        // the customer; the shared anon-key client always returns null here
        // (drivers cannot read delivery_otps, and unauthenticated RLS yields
        // no rows), which would silently disable the guard below.
        const { data: otpCheck } = await this.orderRepository.findVerifiedDeliveryOtp(currentOrder.id, userClient);
        if (otpCheck) {
          throw new DomainError(409, { error: 'Cannot cancel: delivery OTP has already been verified.' });
        }

        // The driver has already started the trip — a full-refund cancellation is
        // no longer possible. This customer cancellation flow rejects after
        // pickup, while on-chain cancelWithPenalty remains available for
        // owner-managed compensation if policy permits it.
        if (['picked_up', 'in_transit', 'arriving', 'arrived_dropoff'].includes(currentOrder.status)) {
          throw new DomainError(409, { error: 'Cannot cancel: the shipment has already been picked up and is in transit.' });
        }

        const requiresRefund = ['funding', 'funded', 'refund_pending', 'refund_failed'].includes(currentOrder.escrow_status);
        const penaltyBps = currentOrder.status === 'truck_assigned'
          ? 1000
          : ['arrived_pickup', 'picked_up', 'in_transit', 'delivered'].includes(currentOrder.status)
            ? 5000
            : 0;
        const cancellationFee = currentOrder.total_amount && penaltyBps > 0
          ? Math.round((Number(currentOrder.total_amount) * penaltyBps) / 10_000)
          : currentOrder.cancellation_fee ?? 0;
        const escrowAmountWei = currentOrder.escrow_amount_wei ? BigInt(currentOrder.escrow_amount_wei) : 0n;
        const driverFeeWei = (escrowAmountWei * BigInt(penaltyBps)) / 10_000n;

        if (currentOrder.status === 'cancelled' && (!requiresRefund || currentOrder.escrow_status === 'refunded')) {
          await this.revokeTrackingTokensForOrder(currentOrder.order_display_id);
          return {
            status: 200,
            body: {
              message: currentOrder.escrow_status === 'refunded' ? 'Order was already cancelled and refunded.' : 'Order was already cancelled.',
              cancellation_fee: currentOrder.cancellation_fee ?? 0,
              order: currentOrder,
            },
          };
        }

        let workingOrder = currentOrder;

        if (requiresRefund) {
          const cancelSaga = this.sagaCoordinatorFactory({
            name: 'OrderCancellationSaga',
            statePersister: this.sagaPersister,
            logger,
          });

          // Step 1: Record Pre-Cancellation status in DB (refund_pending)
          cancelSaga.addStep({
            name: 'record_refund_pending',
            execute: async (ctx) => {
              if (currentOrder.status !== 'cancelled' || currentOrder.escrow_status !== 'refund_pending') {
                const attemptAt = new Date().toISOString();
                const { data: pendingRows, error: pendingErr } = await this.orderRepository.executeRpc(
                  'update_order_status_tx',
                  {
                    p_order_id: currentOrder.id,
                    p_status: 'cancelled',
                    p_not_statuses: ['delivered', 'payment_released'],
                    p_cancellation_reason: reason ?? currentOrder.cancellation_reason,
                    p_cancellation_fee: cancellationFee,
                    p_escrow_status: 'refund_pending',
                    p_escrow_refund_attempts: (currentOrder.escrow_refund_attempts ?? 0) + 1,
                    p_escrow_refund_last_attempt_at: attemptAt,
                    p_clear_escrow_refund_error: true,
                    p_event_type: 'ORDER_CANCELLED',
                    p_payload_extra: {
                      cancellation_reason: reason ?? currentOrder.cancellation_reason,
                      cancellation_fee: cancellationFee,
                    },
                  },
                  supabaseAdmin
                );

                if (pendingErr) {
                  throw new DomainError(500, {
                    error: 'Failed to place the order into refund reconciliation.',
                    details: pendingErr.message,
                  });
                }
                if (!pendingRows || pendingRows.length === 0) {
                  throw new DomainError(409, { error: 'Order was already delivered or payment released. Cannot cancel.' });
                }
                ctx.workingOrder = pendingRows[0];
              } else {
                ctx.workingOrder = currentOrder;
              }
              return { workingOrder: ctx.workingOrder };
            },
            compensate: async (ctx, compErr) => {
              logger.warn(`[Saga:OrderCancellationSaga] Pre-cancel step compensated for order ${currentOrder.id}: ${compErr?.message}`);
            },
          });

          // Step 2: Submit on-chain escrow refund transaction
          cancelSaga.addStep({
            name: 'submit_on_chain_refund',
            execute: async (ctx) => {
              let refundTxHash = ctx.workingOrder?.refund_tx_hash ?? null;
              let receipt;

              if (refundTxHash) {
                receipt = await confirmEscrowRefund(refundTxHash);
              } else {
                const submitted = driverFeeWei > 0n
                  ? await submitEscrowCancelWithPenalty(ctx.workingOrder.order_display_id, driverFeeWei)
                  : await submitEscrowRefund(ctx.workingOrder.order_display_id);
                refundTxHash = submitted.txHash;
                if (!refundTxHash || !submitted.waitForConfirmation) {
                  throw new Error('Escrow refund transaction was not submitted.');
                }

                const submittedAt = new Date().toISOString();
                await this.orderRepository.updateOrder(currentOrder.id, {
                  refund_tx_hash: refundTxHash,
                  escrow_refund_submitted_at: submittedAt,
                  updated_at: submittedAt,
                });

                receipt = await submitted.waitForConfirmation();
              }

              return { receipt, refundTxHash };
            },
            compensate: async (ctx, compErr) => {
              const refundTxHash = ctx.refundTxHash ?? ctx.workingOrder?.refund_tx_hash ?? null;
              const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
              logger.error('[escrow] Refund failed for order', orderId, ':', compErr?.message);
              const failedAt = new Date().toISOString();

              await this.orderRepository.executeRpc(
                'update_order_status_tx',
                {
                  p_order_id: currentOrder.id,
                  p_status: 'cancelled',
                  p_cancellation_fee: cancellationFee,
                  p_escrow_status: nextEscrowStatus,
                  p_refund_tx_hash: refundTxHash,
                  p_escrow_refund_error: String(compErr?.message || compErr).slice(0, 1000),
                  p_escrow_refund_last_attempt_at: failedAt,
                  p_event_type: 'ORDER_UPDATED',
                  p_payload_extra: {
                    escrow_status: nextEscrowStatus,
                    escrow_refund_error: String(compErr?.message || compErr).slice(0, 1000),
                    retryable: true,
                  },
                },
                supabaseAdmin
              );

              await this.orderRepository.updateOrder(currentOrder.id, {
                status: 'cancelled',
                cancellation_fee: cancellationFee,
                escrow_status: nextEscrowStatus,
                refund_tx_hash: refundTxHash,
                escrow_refund_error: String(compErr?.message || compErr).slice(0, 1000),
                escrow_refund_last_attempt_at: failedAt,
                updated_at: failedAt,
              });
            },
          });

          // Step 3: Confirm final status in DB (refunded)
          cancelSaga.addStep({
            name: 'confirm_order_refunded',
            execute: async (ctx) => {
              const refundedAt = new Date().toISOString();
              const { data: updatedRows, error: updateErr } = await this.orderRepository.executeRpc(
                'update_order_status_tx',
                {
                  p_order_id: currentOrder.id,
                  p_status: 'cancelled',
                  p_escrow_in_statuses: ['refund_pending', 'refund_failed'],
                  p_cancellation_reason: reason ?? ctx.workingOrder.cancellation_reason,
                  p_cancellation_fee: cancellationFee,
                  p_escrow_status: 'refunded',
                  p_refund_tx_hash: ctx.receipt?.hash ?? ctx.refundTxHash,
                  p_escrow_refunded_at: refundedAt,
                  p_clear_escrow_refund_error: true,
                  p_event_type: 'ORDER_UPDATED',
                  p_payload_extra: {
                    escrow_status: 'refunded',
                    refund_tx_hash: ctx.receipt?.hash ?? ctx.refundTxHash,
                    escrow_refunded_at: refundedAt,
                  },
                },
                supabaseAdmin
              );

              if (updateErr || !updatedRows || updatedRows.length === 0) {
                logger.error(
                  '[escrow] Refund confirmed but final order update failed for',
                  orderId,
                  ':',
                  updateErr?.message ?? 'escrow-status guard rejected the update'
                );
                ctx.reconciliationPending = true;
                return { reconciliationPending: true };
              }

              return { updatedOrder: updatedRows[0] };
            },
          });

          // Step 4: Cleanup & Side Effects
          cancelSaga.addStep({
            name: 'cleanup_and_side_effects',
            execute: async (ctx) => {
              if (!ctx.reconciliationPending) {
                await this.orderTimelineService.insertCancelEvent(currentOrder.order_display_id);
                await expireDeliveryOtps(currentOrder.id);
                await this.revokeTrackingTokensForOrder(currentOrder.order_display_id);
              }
            },
          });

          try {
            const sagaResult = await cancelSaga.execute({
              orderId: currentOrder.id,
              orderDisplayId: currentOrder.order_display_id,
              customerId,
              reason,
              cancellationFee,
              driverFeeWei,
              workingOrder,
            });

            if (sagaResult.context.reconciliationPending) {
              return {
                status: 202,
                body: {
                  message: 'Order cancelled and escrow refund confirmed. Database reconciliation is pending.',
                  refund_tx_hash: sagaResult.context.receipt?.hash ?? sagaResult.context.refundTxHash,
                  escrow_status: 'refund_pending',
                  reconciliation_required: true,
                },
              };
            }

            const updatedOrder = sagaResult.context.updatedOrder;
            return {
              status: 200,
              body: {
                message: 'Order cancelled and escrow refunded successfully.',
                cancellation_fee: updatedOrder?.cancellation_fee ?? 0,
                order: updatedOrder,
              },
            };
          } catch (sagaErr) {
            const originalError = sagaErr.triggerError || sagaErr;
            if (originalError instanceof DomainError) {
              throw originalError;
            }

            const refundTxHash = cancelSaga.getContext().refundTxHash ?? workingOrder.refund_tx_hash ?? null;
            const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
            // The saga compensates only COMPLETED steps — a step-2 execute
            // failure never reaches its own compensate, so the failure state
            // must be persisted here or the row stays 'refund_pending' while
            // the client was told refund_failed (reconciliation would never
            // retry it under the wrong status).
            await this.orderRepository.updateOrder(currentOrder.id, {
              escrow_status: nextEscrowStatus,
              escrow_refund_error: String(originalError?.message ?? originalError).slice(0, 1000),
              escrow_refund_last_attempt_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            }).catch((persistErr) => logger.warn('[escrow] Failed to persist refund failure state:', persistErr?.message));
            return {
              status: 202,
              body: {
                message: 'Order cancelled. Escrow refund requires reconciliation.',
                escrow_status: nextEscrowStatus,
                refund_tx_hash: refundTxHash,
                retryable: true,
              },
            };
          }
        } else if (currentOrder.escrow_booking_id) {
          logger.info(`[escrow] Escrow not funded (status: ${currentOrder.escrow_status}) - skipping on-chain refund.`);
        }

        const { data: updatedRows, error: updateErr } = await this.orderRepository.executeRpc(
          'update_order_status_tx',
          {
            p_order_id: currentOrder.id,
            p_status: 'cancelled',
            p_not_statuses: ['delivered', 'payment_released', 'cancelled'],
            p_cancellation_reason: reason,
            p_cancellation_fee: cancellationFee,
            p_event_type: 'ORDER_CANCELLED',
            p_payload_extra: {
              cancellation_reason: reason,
              cancellation_fee: cancellationFee,
            },
          },
          supabaseAdmin
        );

        if (updateErr) {
          throw new DomainError(500, { error: 'Failed to cancel order.', details: updateErr.message });
        }
        if (!updatedRows || updatedRows.length === 0) {
          throw new DomainError(409, { error: 'Order was already cancelled, delivered, or payment released. Cannot cancel.' });
        }
        const updatedOrder = updatedRows[0];

        const persistedCancellationFee = updatedOrder?.cancellation_fee ?? cancellationFee;

        await this.orderTimelineService.insertCancelEvent(currentOrder.order_display_id);
        await expireDeliveryOtps(currentOrder.id);
        await this.revokeTrackingTokensForOrder(currentOrder.order_display_id);

        return {
          status: 200,
          body: { message: 'Order cancelled successfully.', cancellation_fee: persistedCancellationFee, order: updatedOrder },
        };
      } finally {
        await lock.release();
      }
    });
  }

  async confirmDeposit(orderId, userId, txHash, userClient) {
    return measureExecution('OrderLifecycleService.confirmDeposit', async () => {
      const lockKey = `escrow_lock:${orderId}`;
      const lock = await acquireLockOrFallback(lockKey, 30000);
      if (!lock.ok) {
        throw new DomainError(409, { error: 'Order is currently being processed. Please try again later.' });
      }

      try {
        const { data: order, error: fetchErr } = await this.orderRepository.findOrderById(
          orderId, 'id, status, order_display_id, customer_id, escrow_booking_id, escrow_status, escrow_amount_wei, escrow_driver_wallet, pending_bid_acceptance'
        );

        if (fetchErr || !order) throw new DomainError(404, { error: 'Order not found' });
        if (order.customer_id !== userId) {
          throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
        }
        if (order.escrow_status !== 'funding') {
          throw new DomainError(400, { error: 'Order is not in funding state' });
        }

        const { data: customerProfile } = await this.orderRepository.findCustomerWallet(userId);
        const customerWallet = customerProfile?.polygon_wallet_address ?? null;

        const bookingId = order.escrow_booking_id || getEscrowBookingId(order.order_display_id);

        // Resolve the authoritative expected deposit amount (cross-checked
        // against the server-written bid context) and reject the deposit if it
        // cannot be pinned down or if the stored figures disagree.
        const resolvedAmount = resolveExpectedDepositAmount(order);
        if (resolvedAmount.error) {
          throw new DomainError(422, { error: resolvedAmount.error, code: resolvedAmount.code });
        }
        const expectedAmountWei = resolvedAmount.expectedAmountWei;

        const result = await recordDepositTx(
          bookingId,
          txHash,
          customerWallet,
          order.escrow_driver_wallet ?? null,
          expectedAmountWei
        );

        if (result.error) throw new DomainError(422, { error: result.error, code: result.code });

        const { data: fundedRows, error: updateErr } = await this.orderRepository.executeRpc(
          'update_order_status_tx',
          {
            p_order_id: orderId,
            p_status: order.status,
            p_escrow_in_statuses: ['funding'],
            p_escrow_status: 'funded',
            p_event_type: 'PAYMENT_CONFIRMED',
            p_payload_extra: {
              tx_hash: txHash,
              escrow_booking_id: bookingId,
            },
          },
          supabaseAdmin
        );

        if (updateErr || !fundedRows || fundedRows.length === 0) {
          logger.error(
            '[confirm-deposit] DB update failed:',
            updateErr?.message ?? 'escrow-status guard rejected the update'
          );
          const { error: fallbackErr } = await this.orderRepository.updateOrder(orderId, {
            escrow_status: 'funded',
          });

          if (fallbackErr) {
            logger.error('[confirm-deposit] Fallback DB update failed:', fallbackErr.message);
            throw new DomainError(500, { error: 'Database update failed after deposit confirmation. Please contact support.' });
          }
        }

        // Two-phase acceptance (#5724): finalize the driver assignment now that
        // the escrow deposit is confirmed.
        const pending = order.pending_bid_acceptance;
        if (pending) {
          const { error: acceptErr } = await this.orderRepository.executeRpc('accept_bid_tx', {
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
          }, userClient ?? supabaseAdmin);
          if (acceptErr) {
            logger.error('[confirm-deposit] accept_bid_tx failed:', acceptErr.message);
            try {
              await submitEscrowRefund(order.order_display_id);
            } catch (refundErr) {
              logger.error('[confirm-deposit] Escrow refund also failed:', refundErr.message);
            }
            await this.orderRepository.revertEscrowStatus(orderId).catch((revertErr) => {
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
        }

        return { message: 'Escrow deposit confirmed', txHash: result.txHash };
      } finally {
        await lock.release();
      }
    });
  }

  async submitRating(orderId, customerId, stars, comment, userClient) {
    return measureExecution('OrderLifecycleService.submitRating', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderByAnyId(
        orderId, 'id, order_display_id, customer_id, driver_id, status'
      );

      if (orderErr) throw new DomainError(500, { error: 'Failed to fetch order.', details: orderErr.message });
      if (!order) throw new DomainError(404, { error: 'Order not found.' });
      if (order.customer_id !== customerId) throw new DomainError(403, { error: 'Access Denied: You do not own this order.' });
      if (!['delivered', 'payment_released'].includes(order.status)) {
        throw new DomainError(400, { error: 'Order must be delivered before a rating can be submitted.' });
      }
      if (!order.driver_id) throw new DomainError(400, { error: 'Order does not have an assigned driver.' });

      const { data: existingRating } = await this.orderRepository.findRatingByOrder(order.order_display_id, customerId);
      if (existingRating) {
        throw new DomainError(409, { error: 'A rating has already been submitted for this order.' });
      }

      const { error: rpcErr } = await this.orderRepository.executeRpc('submit_rating_tx', {
        p_order_display_id: order.order_display_id,
        p_customer_id: customerId,
        p_driver_id: order.driver_id,
        p_stars: stars,
        p_comment: comment,
      }, userClient ?? supabaseAdmin);

      if (rpcErr) throw new DomainError(500, { error: 'Failed to submit rating.', details: rpcErr.message });

      const { data: driverDetails } = await this.orderRepository.findDriverWallet(order.driver_id);
      const polygonAddress = driverDetails?.polygon_wallet_address ?? null;

      if (polygonAddress) {
        eventBus.emitSafe('rating:submitted', {
          driverWallet: polygonAddress,
          stars,
          orderDisplayId: order.order_display_id
        });
      } else {
        logger.warn(`[reputation] Driver ${order.driver_id} has no polygon_wallet_address - skipping on-chain update.`);
      }

      return {
        message: 'Rating submitted successfully.',
        rating: {
          order_display_id: order.order_display_id,
          customer_id: customerId,
          driver_id: order.driver_id,
          stars,
          comment,
        },
      };
    });
  }
}
