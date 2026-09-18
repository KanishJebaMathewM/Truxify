import { supabase, mongoDb } from '../config/db.js';
import { OrderRepository } from '../repositories/orderRepository.js';
import { BidAcceptanceService, DomainError } from '../services/order/bidAcceptanceService.js';
import { OrderTimelineService } from '../services/order/orderTimelineService.js';
import { OrderLifecycleService } from '../services/order/orderLifecycleService.js';
import { OrderValidationService } from '../services/order/orderValidationService.js';
import { buildDepositTx, recordDepositTx, submitEscrowRefund } from '../services/escrow.js';
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
  escrowRefundFn: submitEscrowRefund,
  logger,
});

const orderLifecycleService = new OrderLifecycleService({
  orderRepository,
  orderTimelineService,
  bidAcceptanceService,
});

export const createOrder = async (req, res, next) => {
  try {
    const { order } = await orderLifecycleService.createOrder(req.user.id, req.user.fullName || 'Customer', req.body);
    res.status(201).json({ message: 'Order created successfully and broadcasted to loads board.', order });
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('Order creation exception:', err.message);
    next(new AppError('Internal Server Error.', 500, "INTERNAL_ERROR"));
  }
};

export const getActiveOrders = async (req, res, next) => {
  try {
    const orders = await orderLifecycleService.getActiveOrders(req.user.id);
    res.json(orders);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to fetch active orders:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { from: (page - 1) * limit, to: page * limit - 1 };
}

async function fetchLoadOffers(req, res, next, { isEnRoute, label }) {
  const { from, to } = parsePagination(req.query);
  try {
    const { data: offers, error } = await supabase
      .from('load_offers')
      .select('*')
      .eq('is_en_route', isEnRoute)
      .order('created_at', { ascending: false })
      .range(from, to);

    if (error) return next(new AppError(`Failed to fetch ${label}.`, details: error.message, 500, "INTERNAL_ERROR"));
    res.json(offers);
  } catch (err) {
    logger.error(`[orderController] Failed to fetch ${label}:`, err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
}

export const getLoadOffers = (req, res, next) => fetchLoadOffers(req, res, next, { isEnRoute: false, label: 'load offers' });

export const getEnRouteLoads = (req, res, next) => fetchLoadOffers(req, res, next, { isEnRoute: true, label: 'en-route loads' });

export const getOrderHistory = async (req, res, next) => {
  try {
    const pageParam = req.query.page ?? '1';
    const limitParam = req.query.limit ?? '10';
    const page = typeof pageParam === 'string' ? Number(pageParam) : NaN;
    const limit = typeof limitParam === 'string' ? Number(limitParam) : NaN;

    if (!Number.isInteger(page) || page < 1) {
      return next(new AppError('page must be greater than or equal to 1', 400, "VALIDATION_ERROR"));
    }

    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      return next(new AppError('limit must be between 1 and 100', 400, "VALIDATION_ERROR"));
    }

    const result = await orderLifecycleService.getOrderHistory(req.user.id, page, limit);
    res.json(result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to fetch order history:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const getOrderDetails = async (req, res, next) => {
  try {
    const details = await orderLifecycleService.getOrderDetail(req.params.id, req.user.id);
    res.json(details);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to fetch order details:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const getOrderTimeline = async (req, res, next) => {
  try {
    const timeline = await orderLifecycleService.getOrderTimeline(req.params.id, req.user.id);
    res.json(timeline);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to fetch order timeline:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const submitBid = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.submitBid(req.params.id, req.user.id, req.body.bid_amount);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to submit bid:", err.message);
    next(new AppError('Internal Server Error.', 500, "INTERNAL_ERROR"));
  }
};

export const submitRating = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.submitRating(req.params.id, req.user.id, req.body.stars, req.body.comment);
    res.status(201).json(result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to submit rating:", err.message);
    next(new AppError('Internal Server Error.', 500, "INTERNAL_ERROR"));
  }
};

export const getBids = async (req, res, next) => {
  try {
    const bids = await orderLifecycleService.getBidsForOrder(req.params.id, req.user.id);
    res.json(bids);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Failed to fetch bids:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const acceptBid = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.acceptBid(req.params.id, req.params.bidId, req.user.id);
    res.status(result.status).json(result.body);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('Bid acceptance exception:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const updateMilestone = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.updateMilestone(req.params.id, req.body.milestone, req.user.id);
    res.json({ message: 'Milestone updated successfully.', ...result });
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error("[orderController] Milestone update error:", err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const verifyDeliveryController = async (req, res, next) => {
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
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('[verify-delivery] Exception:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const resendOtp = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.resendOtpFn(req.params.id, req.user.id);
    res.json({ message: 'New delivery OTP sent.', ...result });
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('[orderController] Resend OTP error:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const changeDrop = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.changeDrop(req.params.id, req.user.id, req.body);
    res.json(result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('Change drop exception:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const cancelOrder = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.cancelOrder(req.params.id, req.user.id, req.body.reason);
    res.status(result.status || 200).json(result.body || result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('Cancel order exception:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const confirmDeposit = async (req, res, next) => {
  try {
    const result = await orderLifecycleService.confirmDeposit(req.params.id, req.user.id, req.body.txHash);
    res.json(result);
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error('[confirm-deposit] Exception:', err.message);
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const predictRideDemand = async (req, res, next) => {
  try {
    const prediction = await predictDemand(req.body);
    res.json(prediction);
  } catch (err) {
    logger.error('[ML integration] Demand prediction failed:', err.message);
    next(new AppError('Failed to fetch demand prediction from ML engine.', 502, "BAD_GATEWAY", { details: err.message }));
  }
};

export const getDriverLocation = async (req, res, next) => {
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id, status');
    orderValidationService.assertOrderFound(order);

    if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
      return next(new AppError('Access Denied: You do not own this order.', 403, "FORBIDDEN"));
    }
    if (req.user.role === 'driver' && order.driver_id !== req.user.id) {
      return next(new AppError('Access Denied: You are not assigned to this order.', 403, "FORBIDDEN"));
    }

    if (!order.driver_id) {
      return next(new AppError('No driver assigned to this order.', 404, "NOT_FOUND"));
    }

    if (!mongoDb) {
      return next(new AppError('Telemetry database not available.', 503, "SERVICE_UNAVAILABLE"));
    }

    const latestTelemetry = await mongoDb
      .collection('telemetry')
      .find({ driver_id: order.driver_id, order_id: order.id })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (!latestTelemetry || latestTelemetry.length === 0) {
      return next(new AppError('No live telemetry found for this driver.', 404, "NOT_FOUND"));
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
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error({ err }, 'Fetch driver location exception');
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};

export const getLiveRouteGeometry = async (req, res, next) => {
  try {
    const order = await orderValidationService.findOrderByIdOrDisplayId(req.params.id, 'id, customer_id, driver_id, status, pickup_lat, pickup_lng, drop_lat, drop_lng');
    orderValidationService.assertOrderFound(order);

    if (req.user.role === 'customer' && order.customer_id !== req.user.id) {
      return next(new AppError('Access Denied: You do not own this order.', 403, "FORBIDDEN"));
    }
    if (req.user.role === 'driver' && order.driver_id !== req.user.id) {
      return next(new AppError('Access Denied: You are not assigned to this order.', 403, "FORBIDDEN"));
    }

    if (order.drop_lat == null || order.drop_lng == null) {
      return next(new AppError('Order is missing destination coordinates.', 500, "INTERNAL_ERROR"));
    }

    if (!order.driver_id) {
      const originLat = Number(order.pickup_lat);
      const originLng = Number(order.pickup_lng);
      const destLat = Number(order.drop_lat);
      const destLng = Number(order.drop_lng);

      if (!Number.isFinite(originLat) || !Number.isFinite(originLng) ||
          !Number.isFinite(destLat) || !Number.isFinite(destLng)) {
        return next(new AppError('Order has invalid coordinates.', 500, "INTERNAL_ERROR"));
      }

      const feature = buildStraightLineGeometry({ originLat, originLng, destLat, destLng });
      if (!feature) {
        return next(new AppError('Failed to compute route.', 500, "INTERNAL_ERROR"));
      }
      return res.json({ ...feature, fallback: true });
    }

    if (!mongoDb) {
      return next(new AppError('Telemetry database not available.', 503, "SERVICE_UNAVAILABLE"));
    }

    const latestTelemetry = await mongoDb
      .collection('telemetry')
      .find({ driver_id: order.driver_id, order_id: order.id })
      .sort({ timestamp: -1 })
      .limit(1)
      .toArray();

    if (!latestTelemetry || latestTelemetry.length === 0) {
      return next(new AppError('No live telemetry found for this driver.', 404, "NOT_FOUND"));
    }

    const originLat = Number(latestTelemetry[0].lat);
    const originLng = Number(latestTelemetry[0].lng);

    if (!Number.isFinite(originLat) || !Number.isFinite(originLng)) {
      return next(new AppError('Latest telemetry record is missing valid coordinates.', 404, "NOT_FOUND"));
    }

    const destLat = Number(order.drop_lat);
    const destLng = Number(order.drop_lng);

    if (!Number.isFinite(destLat) || !Number.isFinite(destLng)) {
      logger.error(`[route] Order ${order.id} has non-numeric destination coordinates.`);
      return next(new AppError('Order has invalid destination coordinates.', 500, "INTERNAL_ERROR"));
    }

    let feature = await getRouteGeometry({ originLat, originLng, destLat, destLng });
    let usedFallback = false;

    if (!feature) {
      logger.warn(`[route] OSRM unavailable for order ${order.id}, falling back to straight line.`);
      feature = buildStraightLineGeometry({ originLat, originLng, destLat, destLng });
      usedFallback = true;
    }

    if (!feature) {
      return next(new AppError('Failed to compute route.', 502, 'BAD_GATEWAY'));
    }

    return res.json({ ...feature, fallback: usedFallback });
  } catch (err) {
    if (err instanceof DomainError) return next(new AppError(err.message, err.status, "DOMAIN_ERROR", err.payload));
    logger.error({ err }, 'Fetch order route exception');
    next(new AppError('Internal Server Error', 500, "INTERNAL_ERROR"));
  }
};
