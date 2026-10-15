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
        if (await checkOtpLockout(orderId)) {
          throw new DomainError(429, {
            error: `Too many failed OTP attempts. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
          });
        }

        const { data: order, error: orderErr } =
          await this.orderRepository.findOrderById(
            orderId,
            "id, order_display_id, driver_id, customer_id, escrow_status, escrow_amount_wei, escrow_release_attempts, status, release_tx_hash, drop_lat, drop_lng, toll_estimate, base_freight, platform_fee, total_amount, pending_bid_acceptance",
          );

        if (orderErr || !order) {
          throw new DomainError(404, { error: "Order not found." });
        }

        if (order.driver_id !== driverId) {
          throw new DomainError(403, {
            error: "Access Denied: You are not assigned to this order.",
          });
        }

        const isRetryForStuckEscrow =
          order.status === "payment_released" &&
          ["funded", "release_failed"].includes(order.escrow_status);

        if (
          !DELIVERY_OTP_READY_STATUSES.has(order.status) &&
          !isRetryForStuckEscrow
        ) {
          throw new DomainError(409, {
            error:
              "Delivery OTP can only be verified after the shipment reaches the delivery location.",
          });
        }

        const otpRecord =
          await this.notificationService.getActiveDeliveryOtp(orderId);
        if (!otpRecord) {
          throw new DomainError(400, {
            error:
              "OTP not available or has expired. Please request a new delivery OTP.",
          });
        }

        const isMatch =
          this.notificationService.verifyDeliveryOtpHash(otp, otpRecord);

        if (!isMatch) {
          const count = await recordOtpFailure(orderId);
          const remaining = Math.max(0, OTP_MAX_FAILED_ATTEMPTS - count);
          const message =
            remaining > 0
              ? `Invalid OTP. ${remaining} attempt(s) remaining before lockout.`
              : `Invalid OTP. Verification is locked for ${OTP_LOCKOUT_MINUTES} minutes due to too many failed attempts.`;
          logger.warn(
            `[DeliveryVerificationService] Failed verification attempt for order ${orderId} by driver ${driverId}. ${remaining} attempts remaining.`,
          );
          throw new DomainError(400, { error: message });
        }

        return { order, otpRecord };
      },
    );
  }

  async completeDeliveryOtp({ otpRecordId, orderId }) {
    return measureExecution(
      "DeliveryVerificationService.completeDeliveryOtp",
      async () => {
        const verified =
          await this.notificationService.verifyDeliveryOtp(otpRecordId);
        if (!verified) {
          logger.warn(
            "[DeliveryVerificationService] Failed to mark OTP as verified for order",
            orderId,
          );
        }
        await clearOtpState(orderId);
      },
    );
  }

  async ensureDeliveryOtp({ orderId }) {
    return measureExecution(
      "DeliveryVerificationService.ensureDeliveryOtp",
      async () => {
        if (await checkOtpLockout(orderId)) {
          throw new DomainError(429, {
            error: `Too many failed OTP attempts. Delivery OTP is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
          });
        }

        const activeOtp =
          await this.notificationService.getActiveDeliveryOtp(orderId);
        if (activeOtp) {
          logger.warn(
            `[DeliveryVerificationService] Driver attempted OTP regeneration for order ${orderId}`,
          );
          return { generated: false, otp: null };
        }

        const otp = crypto.randomInt(100000, 1000000).toString();
        const stored = await this.notificationService.storeDeliveryOtp(
          orderId,
          otp,
          OTP_TTL_MINUTES,
        );
        if (!stored) {
          throw new Error("Failed to generate delivery OTP.");
        }
        await clearOtpState(orderId);
        return { generated: true, otp };
      },
    );
  }

  async resendDeliveryOtp({
    orderId,
    customerId,
    orderDisplayId,
    orderStatus,
  }) {
    return measureExecution(
      "DeliveryVerificationService.resendDeliveryOtp",
      async () => {
        if (await checkOtpLockout(orderId)) {
          throw new DomainError(429, {
            error: `Too many failed OTP attempts. Delivery OTP is locked for ${OTP_LOCKOUT_MINUTES} minutes.`,
          });
        }

        const terminalStatuses = ["delivered", "cancelled", "payment_released"];
        if (terminalStatuses.includes(orderStatus)) {
          throw new DomainError(400, {
            error: "Cannot resend OTP for a completed or cancelled order.",
          });
        }
        if (!DELIVERY_OTP_READY_STATUSES.has(orderStatus)) {
          throw new DomainError(409, {
            error:
              "Delivery OTP can only be sent after the shipment reaches the delivery location.",
          });
        }

        const activeOtp =
          await this.notificationService.getActiveDeliveryOtp(orderId);
        const otp = crypto.randomInt(100000, 1000000).toString();
        const stored = await this.notificationService.storeDeliveryOtp(
          orderId,
          otp,
          OTP_TTL_MINUTES,
        );
        if (!stored) {
          throw new Error("Failed to generate delivery OTP.");
        }
        if (!activeOtp) {
          await clearOtpState(orderId);
        }

        const notifResult =
          await this.notificationService.sendDeliveryOtpNotification(
            customerId,
            orderDisplayId,
            otp,
          );
        if (!notifResult.success) {
          logger.warn(
            `[DeliveryVerificationService] Resend OTP notification failed for order ${orderDisplayId} — FCM error: ${notifResult.fcm?.error || "unknown"}`,
          );
        }

        return { expiresInMinutes: OTP_TTL_MINUTES };
      },
    );
  }

  async sendOtpNotification({ orderId, customerId, orderDisplayId, otp }) {
    return measureExecution(
      "DeliveryVerificationService.sendOtpNotification",
      async () => {
        const notifResult =
          await this.notificationService.sendDeliveryOtpNotification(
            customerId,
            orderDisplayId,
            otp,
          );
        if (!notifResult.success) {
          logger.warn(
            `[DeliveryVerificationService] Delivery OTP notification failed for order ${orderDisplayId} — FCM error: ${notifResult.fcm?.error || "unknown"}`,
          );
          await this.orderRepository.updateOrder(orderId, {
            updated_at: new Date().toISOString(),
          });
        }
      },
    );
  }

  async generateDeliveryOtp({ orderId }) {
    return measureExecution(
      "DeliveryVerificationService.generateDeliveryOtp",
      async () => {
        const result = await this.ensureDeliveryOtp({ orderId });
        return { generated: result.generated, otp: result.otp };
      },
    );
  }

  async geofenceAutoConfirm({ orderId, driverId, driverLat, driverLng, geofenceRadiusM }) {
    return measureExecution(
      "DeliveryVerificationService.geofenceAutoConfirm",
      async () => {
        const { data: order, error: orderErr } =
          await this.orderRepository.findOrderById(
            orderId,
            "id, order_display_id, driver_id, customer_id, drop_lat, drop_lng, status, escrow_status, total_amount",
          );

        if (orderErr || !order) {
          throw new DomainError(404, { error: "Order not found." });
        }

        if (order.driver_id !== driverId) {
          throw new DomainError(403, {
            error: "Access Denied: You are not assigned to this order.",
          });
        }

        if (!DELIVERY_OTP_READY_STATUSES.has(order.status)) {
          throw new DomainError(409, {
            error:
              'Geofence auto-confirm is only available when the order status is "arriving".',
          });
        }

        if (geofenceRadiusM !== undefined && geofenceRadiusM !== null) {
          if (!Number.isFinite(geofenceRadiusM) || geofenceRadiusM <= 0) {
            throw new DomainError(400, {
              error: "Invalid geofenceRadiusM: must be a positive finite number.",
            });
          }
        }

        const maxRadiusM = DELIVERY_GEOFENCE_RADIUS_KM * 1000;
        const radiusM =
          geofenceRadiusM != null
            ? Math.min(geofenceRadiusM, maxRadiusM)
            : maxRadiusM;
        await this.assertDriverAtDropoff(order, radiusM);

        await this.orderRepository
          .updateOrder(orderId, {
            updated_at: new Date().toISOString(),
          })
          .catch((err) =>
            logger.warn(
              "[geofence] Failed to persist geofence flag:",
              err.message,
            ),
          );

        return {
          autoConfirmed: true,
          message:
            "Driver confirmed at the drop-off via server telemetry. Enter the customer OTP to release payment.",
        };
      },
    );
  }

  async assertDriverAtDropoff(order, radiusM) {
    if (order.drop_lat == null || order.drop_lng == null) {
      throw new DomainError(400, {
        error: "Order is missing drop-off coordinates.",
      });
    }

    if (!mongoDb) {
      throw new DomainError(503, {
        error: "Telemetry database not available.",
        retryable: true,
      });
    }

    const latestTelemetry = await mongoDb
      .collection("telemetry")
      .find({
        driver_id: order.driver_id,
        order_id: order.id,
        order_display_id: order.order_display_id,
      })
      .sort({ server_received_at: -1 })
      .limit(1)
      .toArray();

    const telemetry = latestTelemetry?.[0];
    if (
      !telemetry ||
      telemetry.driver_id !== order.driver_id ||
      telemetry.order_display_id !== order.order_display_id
    ) {
      throw new DomainError(409, {
        error: "Location is not available for this driver on this order.",
      });
    }

    const lat = Number(telemetry.lat);
    const lng = Number(telemetry.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      throw new DomainError(409, {
        error: "The driver's latest location is invalid.",
      });
    }

    const receivedAt = toEpochMs(telemetry.server_received_at);
    if (
      receivedAt === null ||
      Date.now() - receivedAt > DELIVERY_GEOFENCE_MAX_AGE_MS
    ) {
      throw new DomainError(409, {
        error:
          "The driver's location is stale. Please retry once a fresh ping is available.",
      });
    }

    const distanceM =
      haversineKm(lat, lng, Number(order.drop_lat), Number(order.drop_lng)) *
      1000;
    const effectiveRadiusM = radiusM ?? DELIVERY_GEOFENCE_RADIUS_KM * 1000;
    if (distanceM > effectiveRadiusM) {
      throw new DomainError(409, {
        error: `Driver is ${(distanceM / 1000).toFixed(2)}km from the drop-off location. Must be within ${effectiveRadiusM}m to confirm delivery.`,
      });
    }

    logger.info(
      `[geofence] Order ${order.id}: driver telemetry confirmed ${Math.round(distanceM)}m from drop-off.`,
    );
  }

  async verifyDelivery({ orderId, driverId, otp }, userClient) {
    return measureExecution(
      "DeliveryVerificationService.verifyDelivery",
      async () => {
        const { order, otpRecord } = await this.validateDeliveryOtp({
          orderId,
          driverId,
          otp,
        });

        // Bug fix #18104: 'pending' (never-funded escrow) must be treated as escrow-expected
        // and blocked with a retryable 503 instead of falling through to a generic 409 error.
        const escrowExpectedStates = ["pending", "funded", "release_failed", "release_pending"];
        if (order.escrow_status && escrowExpectedStates.includes(order.escrow_status)) {
          if (order.escrow_status === "pending") {
            await this._writeRepository
              .updateOrder(orderId, {
                escrow_release_error: "ESCROW_NOT_RELEASED: Escrow was never funded.",
                updated_at: new Date().toISOString(),
              })
              .catch((err) =>
                logger.warn("[escrow] Failed to record unfunded escrow error:", err.message),
              );
            throw new DomainError(503, {
              error: "Escrow deposit has not been funded yet. Please complete funding before verifying delivery.",
              code: "ESCROW_NOT_RELEASED",
              retryable: true,
            });
          }
        }

        const isRetryForStuckEscrow =
          order.status === "payment_released" &&
          ["funded", "release_failed"].includes(order.escrow_status);

        await this.assertDriverAtDropoff(order);

        let releaseTxHash = null;
        let escrowAlreadyReleased = false;

        if (
          order.escrow_status === "funded" ||
          order.escrow_status === "release_failed"
        ) {
          let expectedAmountWei;
          const resolvedAmount = resolveExpectedDepositAmount(order);
          if (resolvedAmount.expectedAmountWei != null) {
            expectedAmountWei = resolvedAmount.expectedAmountWei;
          } else {
            if (order.total_amount != null) {
              expectedAmountWei = paisaToMaticWei(order.total_amount);
            } else if (order.pending_bid_acceptance?.bid_amount != null) {
              expectedAmountWei = paisaToMaticWei(order.pending_bid_acceptance.bid_amount);
            } else {
              const details = "Order is missing authoritative escrow amount (no escrow_amount_wei, total_amount, or pending_bid_acceptance.bid_amount)";
              logger.error(
                "[escrow] Missing authoritative escrow amount before release for order",
                orderId,
                ":",
                details,
              );
              await this._writeRepository
                .updateOrder(orderId, {
                  escrow_status: "release_failed",
                  escrow_release_error: `ESCROW_AMOUNT_MISSING: ${details}`,
                  updated_at: new Date().toISOString(),
                })
                .catch((err) =>
                  logger.warn(
                    "[escrow] Failed to record missing amount:",
                    err.message,
                  ),
                );
              throw new DomainError(409, {
                error: "Escrow amount missing. Payment cannot be released.",
                code: "ESCROW_AMOUNT_MISSING",
                details,
                retryable: false,
              });
            }
          }

          try {
            const releaseResult = await this.escrowReleaseFn(
              order.order_display_id,
              expectedAmountWei,
            );
            if (releaseResult.txHash) {
              releaseTxHash = releaseResult.txHash;
            } else if (releaseResult.alreadyReleased) {
              escrowAlreadyReleased = true;
              releaseTxHash = order.release_tx_hash || null;
            } else if (releaseResult.code === "DEPOSIT_AMOUNT_MISMATCH") {
              await this._writeRepository
                .updateOrder(orderId, {
                  escrow_status: "release_failed",
                  escrow_release_error: String(releaseResult.error).slice(0, 1000),
                  updated_at: new Date().toISOString(),
                })
                .catch((err) =>
                  logger.warn(
                    "[escrow] Failed to record release amount mismatch:",
                    err.message,
                  ),
                );
              throw new DomainError(409, {
                error:
                  releaseResult.error ||
                  "On-chain escrow amount does not match the expected amount. Payment cannot be released.",
                code: "DEPOSIT_AMOUNT_MISMATCH",
                retryable: false,
              });
            } else {
              throw new Error("Escrow release returned no transaction hash");
            }
          } catch (releaseErr) {
            if (releaseErr instanceof DomainError) throw releaseErr;
            logger.error(
              "[escrow] Blockchain release failed for order",
              orderId,
              ":",
              releaseErr.message,
            );
            await this._writeRepository
              .updateOrder(orderId, {
                escrow_release_error: String(releaseErr.message).slice(0, 1000),
                updated_at: new Date().toISOString(),
              })
              .catch((err) =>
                logger.warn(
                  "[escrow] Failed to record release failure:",
                  err.message,
                ),
              );
            throw new DomainError(503, {
              error:
                "Blockchain escrow release failed. Payment cannot be processed. Please retry.",
              retryable: true,
            });
          }

          if (releaseTxHash || escrowAlreadyReleased) {
            const { error: persistReleaseErr } =
              await this._writeRepository.updateOrder(orderId, {
                escrow_status: "released",
                escrow_release_error: null,
                escrow_released_at: new Date().toISOString(),
                release_tx_hash: releaseTxHash,
              });

            if (persistReleaseErr) {
              logger.error(
                "[escrow] Release confirmed but persistence failed:",
                persistReleaseErr.message,
              );
            }
          }
        } else if (order.escrow_status === "released") {
          releaseTxHash = order.release_tx_hash || null;
        }

        const releaseConfirmed = Boolean(
          releaseTxHash ||
            escrowAlreadyReleased ||
            order.escrow_status === "released",
        );
        if (!releaseConfirmed) {
          logger.error(
            `[verify-delivery] On-chain escrow release not confirmed for order ${orderId} (escrow_status=${order.escrow_status}) — aborting before notification.`,
          );
          await this.orderRepository
            .updateOrder(orderId, {
              escrow_release_error: `ESCROW_NOT_RELEASED: on-chain release not confirmed (escrow_status=${order.escrow_status})`,
              updated_at: new Date().toISOString(),
            })
            .catch((err) =>
              logger.warn(
                "[escrow] Failed to record unconfirmed release:",
                err.message,
              ),
            );
          throw new DomainError(503, {
            error:
              "On-chain escrow release was not confirmed. Payment cannot be processed. Please retry.",
            retryable: true,
          });
        }

        let verifiedOrder;
        let tripData;

        if (!isRetryForStuckEscrow) {
          const guardResult = await this._writeRepository.updateOrderGuardStatus(
            orderId,
            { updated_at: new Date().toISOString() },
            ["cancelled", "payment_released"],
          );

          if (guardResult.error) {
            const pgCode = guardResult.error.code;
            if (pgCode === "PGRST116") {
              throw new DomainError(409, {
                error: "Order was already cancelled or payment released.",
              });
            }
            throw new DomainError(500, {
              error: "Failed to verify OTP.",
              details: guardResult.error.message,
            });
          }

          const rpcResult = await this.orderRepository.executeRpc(
            "complete_trip_tx",
            {
              p_order_id: orderId,
              p_otp_id: otpRecord.id,
              p_release_tx_hash: releaseTxHash,
            },
            supabaseAdmin,
          );
          tripData = rpcResult.data;

          if (rpcResult.error) {
            logger.error(
              "complete
