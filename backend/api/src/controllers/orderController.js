import { supabase, mongoDb } from '../config/db.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { BidAcceptanceService, DomainError } from '../services/order/bidAcceptanceService.js';
import { OrderTimelineService } from '../services/order/orderTimelineService.js';
import { OrderLifecycleService } from '../services/order/orderLifecycleService.js';
import { OrderValidationService } from '../services/order/orderValidationService.js';
import { buildDepositTx, recordDepositTx, escrowRefund } from '../services/escrow.js';
import { predictDemand } from '../services/ml.js';
import { buildStraightLineGeometry, getRouteGeometry } from '../services/osrm.js';
import logger from '../middleware/logger.js';

const orderRepository = new OrderRepository(supabase);
const orderTimelineService = new OrderTimelineService({ supabase, logger });
const orderValidationService = new OrderValidationService({ supabase, logger });

const bidAcceptanceService = new BidAcceptanceService({
  orderRepository,
  buildDepositTxFn: buildDepositTx,
  recordDepositTxFn: recordDepositTx,
  escrowRefundFn: escrowRefund,
  logger,
});

const orderLifecycleService = new OrderLifecycleService({
  orderRepository,
  orderTimelineService,
  bidAcceptanceService,
});

export const createOrder = async (req, res) => {
  try {
    const { order } = await orderLifecycleService.createOrder(req.user.id, req.user.fullName || 'Customer', req.body);
    res.status(201).json({ message: 'Order created successfully and broadcasted to loads board.', order });
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('Order creation exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
};

export const getActiveOrders = async (req, res) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to fetch active orders:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getLoadOffers = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  try {
    const { data: offers, error } = await supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', false)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: 'Failed to fetch load offers.', details: error.message });
    res.json(offers);
  } catch (err) {
    logger.error("[orderController] Failed to fetch load offers:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getEnRouteLoads = async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const from = (page - 1) * limit;
  const to = page * limit - 1;
  try {
    const { data: offers, error } = await supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', true)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return res.status(500).json({ error: 'Failed to fetch en-route loads.', details: error.message });
    res.json(offers);
  } catch (err) {
    logger.error("[orderController] Failed to fetch en-route loads:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getOrderHistory = async (req, res) => {
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
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to fetch order history:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getOrderDetails = async (req, res) => {
  try {
    const details = await orderLifecycleService.getOrderDetail(req.params.id, req.user.id);
    res.json(details);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to fetch order details:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getOrderTimeline = async (req, res) => {
  try {
    const timeline = await orderLifecycleService.getOrderTimeline(req.params.id, req.user.id);
    res.json(timeline);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to fetch order timeline:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const submitBid = async (req, res) => {
  try {
    const result = await orderLifecycleService.submitBid(req.params.id, req.user.id, req.body.bid_amount);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to submit bid:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
};

export const submitRating = async (req, res) => {
  try {
    const result = await orderLifecycleService.submitRating(req.params.id, req.user.id, req.body.stars, req.body.comment);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to submit rating:", err.message);
    res.status(500).json({ error: 'Internal Server Error.' });
  }
};

export const getBids = async (req, res) => {
  try {
    const bids = await orderLifecycleService.getBidsForOrder(req.params.id, req.user.id);
    res.json(bids);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Failed to fetch bids:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const acceptBid = async (req, res) => {
  try {
    const result = await orderLifecycleService.acceptBid(req.params.id, req.params.bidId, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('Bid acceptance exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const updateMilestone = async (req, res) => {
  try {
    const result = await orderLifecycleService.updateMilestone(req.params.id, req.body.milestone, req.user.id);
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error("[orderController] Milestone update error:", err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const verifyDeliveryController = async (req, res) => {
  try {
    const result = await orderLifecycleService.verifyDeliveryFn(req.params.id, req.user.id, req.body.otp);
    if (result && result.escrowUpdateFailed) {
      return res.status(202).json({
        message: 'Delivery verified successfully. Escrow payout requires reconciliation.',
        escrow_status: 'released',
        payment_released: true,
      });
    }
    res.json({ message: 'Delivery verified successfully! Payment released to driver.' });
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('[verify-delivery] Exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const resendOtp = async (req, res) => {
  try {
    const result = await orderLifecycleService.resendOtpFn(req.params.id, req.user.id);
    res.json({ message: 'New delivery OTP sent.', ...result });
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('[orderController] Resend OTP error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const changeDrop = async (req, res) => {
  try {
    const result = await orderLifecycleService.changeDrop(req.params.id, req.user.id, req.body);
    res.json(result);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('Change drop exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const cancelOrder = async (req, res) => {
  try {
    const result = await orderLifecycleService.cancelOrder(req.params.id, req.user.id, req.body.reason);
    res.status(result.status || 200).json(result.body || result);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('Cancel order exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const confirmDeposit = async (req, res) => {
  try {
    const result = await orderLifecycleService.confirmDeposit(req.params.id, req.user.id, req.body.txHash);
    res.json(result);
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error('[confirm-deposit] Exception:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const predictRideDemand = async (req, res) => {
  try {
    const prediction = await predictDemand(req.body);
    res.json(prediction);
  } catch (err) {
    logger.error('[ML integration] Demand prediction failed:', err.message);
    res.status(502).json({
      error: 'Failed to fetch demand prediction from ML engine.',
      details: err.message,
    });
  }
};

export const getDriverLocation = async (req, res) => {
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id, status');
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
    res.json({
      driverId: telemetry.driver_id,
      orderId: telemetry.order_id || order.id,
      lat: telemetry.lat,
      lng: telemetry.lng,
      timestamp: telemetry.timestamp,
    });
  } catch (err) {
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error({ err }, 'Fetch driver location exception');
    res.status(500).json({ error: 'Internal Server Error' });
  }
};

export const getLiveRouteGeometry = async (req, res) => {
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng');
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
    if (err instanceof DomainError) return res.status(err.status).json(err.payload);
    logger.error({ err }, 'Fetch order route exception');
    res.status(500).json({ error: 'Internal Server Error' });
  }
};
