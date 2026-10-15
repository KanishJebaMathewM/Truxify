import crypto from 'crypto';
import { DomainError } from './domainError.js';
import { DeliveryVerificationService } from './deliveryVerificationService.js';
import { expireDeliveryOtps, sendPushNotification } from '../notificationService.js';
import { acquireLock, releaseLock } from '../../lib/redisLock.js';
import { acquireLockOrFallback } from '../../lib/lockFallback.js';
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
