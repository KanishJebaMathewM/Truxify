import { DomainError } from './domainError.js';
import { DeliveryVerificationService } from './deliveryVerificationService.js';
import { expireDeliveryOtps, sendPushNotification } from '../notificationService.js';
import { acquireLock, releaseLock } from '../../lib/redisLock.js';
import { measureExecution } from '../../core/performanceMetrics.js';
import { supabaseAdmin } from '../../config/db.js';
import {
  submitEscrowRefund,
  recordDepositTx,
  submitEscrowCancelWithPenalty,
  confirmEscrowRefund,
  getEscrowBookingId,
  resolveExpectedDepositAmount,
  paisaToMaticWei,
} from '../escrow.js';
import { computeOrderPricing } from '../../lib/pricing.js';
import { getRouteEstimate } from '../osrm.js';
import { optimizeWaypoints } from '../routingService.js';
import { predictPrice } from '../ml.js';
import { getLiveTrafficMultiplier } from '../trafficService.js';
import { eventBus } from '../../core/events/index.js';
import logger from '../../middleware/logger.js';
import { CircuitBreaker } from '../../lib/circuitBreaker.js';

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

export class OrderLifecycleService {
  constructor({ orderRepository, orderTimelineService, bidAcceptanceService, deliveryVerificationService, trackingTokenService }) {
    this.orderRepository = orderRepository;
    this.orderTimelineService = orderTimelineService;
    this.bidAcceptanceService = bidAcceptanceService;
    this.deliveryVerification = deliveryVerificationService || new DeliveryVerificationService(orderRepository);
    this.trackingTokenService = trackingTokenService || null;
  }

  async revokeTrackingTokensForOrder(orderDisplayId) {
    if (!this.trackingTokenService || !orderDisplayId) return;
    try {
      await this.trackingTokenService.revokeAllForOrder(orderDisplayId);
    } catch (error) {
      logger.error(`[OrderLifecycleService] Failed to revoke tracking tokens for order ${orderDisplayId}:`, error);
    }
  }

  async createOrder(customerId, customerName, body) {
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

      let optimizedWaypoints = waypoints;
      if (waypoints && waypoints.length > 0) {
        optimizedWaypoints = await optimizeWaypoints(
          { lat: Number(pickup_lat), lng: Number(pickup_lng), address: pickup_address },
          { lat: Number(drop_lat), lng: Number(drop_lng), address: drop_address },
          waypoints
        );
      }

      let pricing;
      try {
        const routeEstimate = await osrmCircuitBreaker.execute(() => getRouteEstimate({
          pickupLat: Number(pickup_lat),
          pickupLng: Number(pickup_lng),
          dropLat: Number(drop_lat),
          dropLng: Number(drop_lng),
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

      let estimatedPrice = null;
      try {
        const trafficMultiplier = await getLiveTrafficMultiplier(pickup_lat, pickup_lng);

        const mlResult = await mlPriceCircuitBreaker.execute(() => predictPrice({
          distanceKm: pricing.distanceKm,
          cargoWeightKg: Number(weight_tonnes) * 1000,
          routeOrigin: pickup_address,
          routeDestination: drop_address,
          trafficMultiplier,
        }));
        estimatedPrice = mlResult.estimatedPricePaisa;
      } catch (mlErr) {
        logger.warn({ err: mlErr.message }, 'Price prediction unavailable, falling back to base pricing');
      }

      const MAX_ID_RETRIES = ORDER_DISPLAY_ID_MAX_RETRIES;
      let order = null;
      let orderErr = null;
      let orderDisplayId = null;

      for (let attempt = 0; attempt < MAX_ID_RETRIES; attempt++) {
        orderDisplayId = generateOrderDisplayId();
        const result = await this.orderRepository.createOrder({
          order_display_id: orderDisplayId,
          customer_id: customerId,
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
          payment_method_id, upi_id,
          waypoints: optimizedWaypoints,
        });

        order = result.data;
        orderErr = result.error;

        if (!orderErr || orderErr.code !== '23505') break;
        logger.warn(`[Orders] display ID collision on ${orderDisplayId}, retrying (attempt ${attempt + 1}/${MAX_ID_RETRIES})`);
      }

      if (orderErr) {
        logger.error('Order Insertion Error:', orderErr.message);
        throw new DomainError(500, { error: 'Failed to create order record.', details: orderErr.message });
      }

      const { error: timelineErr } = await this.orderTimelineService.generateDefaultTimeline(orderDisplayId);

      if (timelineErr) {
        logger.error('Timeline Insertion Error:', timelineErr.message);
        await this.orderRepository.deleteOrder(order.id);
        throw new DomainError(500, { error: 'Failed to create order timeline.', details: timelineErr.message });
      }

      const { error: offerErr } = await this.orderRepository.createLoadOffer({
        order_display_id: orderDisplayId,
        customer_id: customerId,
        customer_name: customerName || 'Customer',
        route_label: `${pickup_address.split(',')[0]} \u2192 ${drop_address.split(',')[0]}`,
        route_subtitle: `${weight_tonnes} tonnes \u2022 ${goods_type}`,
        pickup_address, pickup_lat, pickup_lng,
        drop_address, drop_lat, drop_lng,
        goods_type,
        weight: `${weight_tonnes} tonnes`,
        freight_value: pricing.totalAmount,
        fuel_cost: pricing.fuelCost,
        toll_cost: pricing.tollEstimate,
        net_profit: pricing.netProfit,
        extra_distance_km: pricing.distanceKm,
        status: 'available',
        waypoints: optimizedWaypoints,
      });

      if (offerErr) {
        logger.error('Load Offer Insertion Error:', offerErr.message);
        await this.orderTimelineService.deleteTimeline(orderDisplayId);
        await this.orderRepository.deleteOrder(order.id);
        throw new DomainError(500, { error: 'Failed to create load offer.', details: offerErr.message });
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
        'id, order_display_id, status, pickup_address, drop_address, pickup_date, total_amount, goods_type, driver_id, eta, created_at',
        { page, limit }
      );

      if (error) throw new DomainError(500, { error: 'Failed to fetch history.', details: error.message });

      const driverIds = [...new Set((history || []).filter(o => o.driver_id).map(o => o.driver_id))];
      if (driverIds.length > 0) {
        const { data: profiles } = await this.orderRepository.findProfilesByIds(driverIds);
        const driverMap = Object.fromEntries((profiles || []).map(p => [p.id, p.full_name]));
        (history || []).forEach(o => { o.driver_name = driverMap[o.driver_id] || 'Driver Assigned'; });
      }

      return {
        page,
        limit,
        total: count || 0,
        totalPages: Math.ceil((count || 0) / limit),
        history: history || [],
      };
    });
  }

  async getOrderDetail(orderId, userId) {
    return measureExecution('OrderLifecycleService.getOrderDetail', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderByAnyId(orderId, '*');
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
          `A driver has submitted a bid of ₹${bidAmount} for your order.`,
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
    return measureExecution('OrderLifecycleService.updateMilestone', async () => {
      const milestoneMap = {
        'Arrived at Pickup': 'at_pickup',
        'Goods Loaded': 'picked_up',
        'In Transit': 'in_transit',
        'Arriving': 'arriving',
        'Arrived at Drop-off': 'at_dropoff',
        'Goods Unloaded': 'at_dropoff',
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
      const updates = { status, updated_at: new Date().toISOString() };
      let generatedOtp = null;

      if (milestone === 'In Transit') {
        const result = await this.deliveryVerification.generateDeliveryOtp({ orderId });
        generatedOtp = result.otp;
      }

      const { error: timelineErr } = await this.orderTimelineService.markMilestoneCompleted(order.order_display_id, milestone);
      if (timelineErr) throw new DomainError(500, { error: 'Failed to update order timeline.', details: timelineErr.message });

      const { data: updatedOrder, error: updateErr } = await this.orderRepository.updateOrder(orderId, updates);
      if (updateErr) {
        await this.orderTimelineService.rollbackMilestone(order.order_display_id, milestone);
        throw new DomainError(500, { error: 'Failed to update order.', details: updateErr.message });
      }

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
      const lockKey = `escrow_lock:${orderId}`;
      const lockValue = await acquireLock(lockKey, 120000);
      if (!lockValue) {
        throw new DomainError(409, { error: 'Delivery verification is currently being processed. Please try again later.' });
      }

      try {
        return await this.deliveryVerification.verifyDelivery({ orderId, driverId, otp }, userClient);
      } finally {
        await releaseLock(lockKey, lockValue);
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
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
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
        const newAmountWei = paisaToMaticWei(pricing.totalAmount);
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
        await releaseLock(lockKey, lockValue);
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
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
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
        // no longer possible. On-chain, cancelBooking / cancelWithPenalty revert
        // once the booking has been marked as started, so reject here first.
        if (['picked_up', 'in_transit', 'arriving', 'delivered'].includes(currentOrder.status)) {
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

        if (requiresRefund && (currentOrder.status !== 'cancelled' || currentOrder.escrow_status !== 'refund_pending')) {
          const attemptAt = new Date().toISOString();
          const { data: pendingOrder, error: pendingErr } = await this.orderRepository.updateOrderGuardStatus(
            currentOrder.id,
            {
              status: 'cancelled',
              cancellation_reason: reason ?? currentOrder.cancellation_reason,
              cancellation_fee: cancellationFee,
              escrow_status: 'refund_pending',
              escrow_refund_error: null,
              escrow_refund_attempts: (currentOrder.escrow_refund_attempts ?? 0) + 1,
              escrow_refund_last_attempt_at: attemptAt,
              updated_at: attemptAt,
            },
            ['delivered', 'payment_released']
          );

          if (pendingErr) {
            if (pendingErr.code === 'PGRST116') {
              throw new DomainError(409, { error: 'Order was already delivered or payment released. Cannot cancel.' });
            }
            throw new DomainError(500, {
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
              const submitted = driverFeeWei > 0n
                ? await submitEscrowCancelWithPenalty(workingOrder.order_display_id, driverFeeWei)
                : await submitEscrowRefund(workingOrder.order_display_id);
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

            const refundedAt = new Date().toISOString();
            const { data: updatedOrder, error: updateErr } = await this.orderRepository.updateOrderWithFilter(
              currentOrder.id,
              {
                status: 'cancelled',
                cancellation_reason: reason ?? workingOrder.cancellation_reason,
                cancellation_fee: cancellationFee,
                escrow_status: 'refunded',
                refund_tx_hash: receipt.hash ?? refundTxHash,
                escrow_refunded_at: refundedAt,
                escrow_refund_error: null,
                updated_at: refundedAt,
              },
              [{ op: 'in', column: 'escrow_status', value: ['refund_pending', 'refund_failed'] }],
              'cancellation_fee, order_display_id, status, cancellation_reason, escrow_status, refund_tx_hash'
            );

            if (updateErr) {
              logger.error('[escrow] Refund confirmed but final order update failed for', orderId, ':', updateErr.message);
              return {
                status: 202,
                body: {
                  message: 'Order cancelled and escrow refund confirmed. Database reconciliation is pending.',
                  refund_tx_hash: receipt.hash ?? refundTxHash,
                  escrow_status: 'refund_pending',
                  reconciliation_required: true,
                },
              };
            }

            await this.orderTimelineService.insertCancelEvent(currentOrder.order_display_id);
            await expireDeliveryOtps(currentOrder.id);
            await this.revokeTrackingTokensForOrder(currentOrder.order_display_id);

            return {
              status: 200,
              body: {
                message: 'Order cancelled and escrow refunded successfully.',
                cancellation_fee: updatedOrder?.cancellation_fee ?? 0,
                order: updatedOrder,
              },
            };
          } catch (refundErr) {
            logger.error('[escrow] Refund failed for order', orderId, ':', refundErr.message);
            const failedAt = new Date().toISOString();
            const nextEscrowStatus = refundTxHash ? 'refund_pending' : 'refund_failed';
            await this.orderRepository.updateOrder(currentOrder.id, {
              status: 'cancelled',
              cancellation_fee: cancellationFee,
              escrow_status: nextEscrowStatus,
              refund_tx_hash: refundTxHash,
              escrow_refund_error: String(refundErr.message || refundErr).slice(0, 1000),
              escrow_refund_last_attempt_at: failedAt,
              updated_at: failedAt,
            });

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

        const updatePayload = {
          status: 'cancelled',
          cancellation_reason: reason,
          cancellation_fee: cancellationFee,
          updated_at: new Date().toISOString(),
        };

        const { data: updatedOrder, error: updateErr } = await this.orderRepository.updateOrderGuardStatus(
          currentOrder.id,
          updatePayload,
          ['delivered', 'payment_released', 'cancelled']
        );

        if (updateErr) {
          if (updateErr.code === 'PGRST116') {
            throw new DomainError(409, { error: 'Order was already cancelled, delivered, or payment released. Cannot cancel.' });
          }
          throw new DomainError(500, { error: 'Failed to cancel order.', details: updateErr.message });
        }

        const persistedCancellationFee = updatedOrder?.cancellation_fee ?? cancellationFee;

        await this.orderTimelineService.insertCancelEvent(currentOrder.order_display_id);
        await expireDeliveryOtps(currentOrder.id);
        await this.revokeTrackingTokensForOrder(currentOrder.order_display_id);

        return {
          status: 200,
          body: { message: 'Order cancelled successfully.', cancellation_fee: persistedCancellationFee, order: updatedOrder },
        };
      } finally {
        await releaseLock(lockKey, lockValue);
      }
    });
  }

  async confirmDeposit(orderId, userId, txHash, userClient) {
    return measureExecution('OrderLifecycleService.confirmDeposit', async () => {
      const lockKey = `escrow_lock:${orderId}`;
      const lockValue = await acquireLock(lockKey, 30000);
      if (!lockValue) {
        throw new DomainError(409, { error: 'Order is currently being processed. Please try again later.' });
      }

      try {
        const { data: order, error: fetchErr } = await this.orderRepository.findOrderById(
          orderId, 'id, order_display_id, customer_id, escrow_booking_id, escrow_status, escrow_amount_wei, escrow_driver_wallet, pending_bid_acceptance'
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

        const { error: updateErr } = await this.orderRepository.updateOrder(orderId, {
          escrow_status: 'funded',
        });

        if (updateErr) {
          logger.error('[confirm-deposit] DB update failed:', updateErr.message);
          throw new DomainError(500, { error: 'Database update failed after deposit confirmation. Please contact support.' });
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
        await releaseLock(lockKey, lockValue);
      }
    });
  }

  async submitRating(orderId, customerId, stars, comment, userClient) {
    return measureExecution('OrderLifecycleService.submitRating', async () => {
      const { data: order, error: orderErr } = await this.orderRepository.findOrderById(
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


/**
 * Creates an order, timeline entry, and load offer in a single durable database transaction.
 */
async function createOrderTransactional({ idempotencyKey, orderData, timelineData, loadOfferData }) {
  if (!idempotencyKey) {
    throw new Error('Idempotency key is required for transactional order creation.');
  }

  try {
    const { data, error } = await db.rpc('create_order_tx', {
      p_idempotency_key: idempotencyKey,
      p_order_data: orderData,
      p_timeline_data: timelineData || { status: 'created', details: { note: 'Order initialized' } },
      p_load_offer_data: loadOfferData || null
    });

    if (error) {
      if (error.code === 'P0001' || error.message.includes('ORDER_CREATION_IN_PROGRESS')) {
        const inProgressErr = new Error('Order creation is currently in progress for this key.');
        inProgressErr.status = 409;
        throw inProgressErr;
      }
      throw error;
    }

    return data;
  } catch (err) {
    console.error(`[TRANSACTIONAL_ORDER_ERROR] Key ${idempotencyKey}:`, err.message);
    throw err;
  }
}

module.exports.createOrderTransactional = createOrderTransactional;
