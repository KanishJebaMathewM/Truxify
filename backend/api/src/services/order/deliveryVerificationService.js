import crypto from "crypto";
import { supabase, supabaseAdmin, redisClient, mongoDb } from "../../config/db.js";
import { DomainError } from "./domainError.js";
import { measureExecution } from "../../core/performanceMetrics.js";
import { haversineKm } from "../../lib/pricing.js";
import {
  sendDeliveryOtpNotification,
  storeDeliveryOtp,
  getActiveDeliveryOtp,
  verifyDeliveryOtp,
  verifyDeliveryOtpHash,
  expireDeliveryOtps,
  sendPushNotification,
} from "../notificationService.js";
import {
  OTP_TTL_MINUTES,
  OTP_MAX_FAILED_ATTEMPTS,
  OTP_LOCKOUT_MINUTES,
  checkOtpLockout,
  recordOtpFailure,
  clearOtpState,
} from "./orderNotificationService.js";
import {
  escrowRelease as defaultEscrowRelease,
  resolveExpectedDepositAmount,
  paisaToMaticWei,
  weiWithinTolerance,
} from "../escrow.js";
import logger from "../../middleware/logger.js";
import { OrderTimelineService } from "./orderTimelineService.js";

const orderTimelineService = new OrderTimelineService({ supabase, logger });

const DELIVERY_OTP_READY_STATUSES = new Set(["arriving"]);

const _rawRadiusKm = Number(process.env.DELIVERY_GEOFENCE_RADIUS_KM);
const DELIVERY_GEOFENCE_RADIUS_KM =
  Number.isFinite(_rawRadiusKm) && _rawRadiusKm > 0 ? _rawRadiusKm : 0.5;
const DELIVERY_GEOFENCE_MAX_AGE_MS =
  Number(process.env.DELIVERY_GEOFENCE_MAX_AGE_MS) || 5 * 60 * 1000;

function toEpochMs(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const time = Date.parse(value);
    return Number.isNaN(time) ? null : time;
  }
  return null;
}

export class DeliveryVerificationService {
  constructor(orderRepository, deps = {}) {
    this.orderRepository = orderRepository;
    // All financial/release evidence writes MUST go through the service_role
    // client: the anon-key client has no RLS policy on `orders` and
    // `escrow_status`/`escrow_release_*` are REVOKE UPDATE from anon, so
    // persisting via it would be a silent no-op and break reconciliation.
    this.adminOrderRepository = deps.adminOrderRepository || null;
    this.orderTimelineService =
      deps.orderTimelineService || new OrderTimelineService(supabase);
    this.notificationService = deps.notificationService || {
      sendDeliveryOtpNotification,
      storeDeliveryOtp,
      getActiveDeliveryOtp,
      verifyDeliveryOtp,
      verifyDeliveryOtpHash,
      expireDeliveryOtps,
    };
    this.escrowReleaseFn = deps.escrowReleaseFn || defaultEscrowRelease;
    this.trackingTokenService = deps.trackingTokenService || null;
  }

  /**
   * Repository used for release-path DB writes (escrow status, release hash,
   * guard updates, wallet description). Falls back to the read repository when
   * no service-role repository was injected (tests, unconfigured admin client).
   */
  get _writeRepository() {
    return this.adminOrderRepository || this.orderRepository;
  }

  async validateDeliveryOtp({ orderId, driverId, otp }) {
    return measureExecution(
      "DeliveryVerificationService.validateDeliveryOtp",
      async () => {
        if (await checkOtpLockout(orderId
