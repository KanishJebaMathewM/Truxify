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
import { escrowRelease as defaultEscrowRelease } from "../escrow.js";
import logger from "../../middleware/logger.js";
import { OrderTimelineService } from "./orderTimelineService.js";

const orderTimelineService = new OrderTimelineService({ supabase, logger });

const DELIVERY_OTP_READY_STATUSES = new Set(["arriving"]);

const DELIVERY_GEOFENCE_RADIUS_KM =
  Number(process.env.DELIVERY_GEOFENCE_RADIUS_KM) || 0.5;
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
            "id, order_display_id, driver_id, customer_id, escrow_status, escrow_release_attempts, status, release_tx_hash, drop_lat, drop_lng, toll_estimate, base_freight, platform_fee, total_amount",
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
        // Only a fresh issuance after the previous OTP expired may reset the
        // failure counter; an active-OTP resend keeps it so repeated resends
        // cannot zero out the brute-force budget.
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
            notification_failed: true,
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

  /**
   * GPS Geofence Confirm
   *
   * Confirms that the assigned driver's *server-ingested* telemetry places
   * them within the geofence of the drop location. Driver-supplied
   * coordinates are never treated as authoritative for this check — the gate
   * runs entirely on telemetry that was authenticated at ingestion and bound
   * to the driver's verified identity.
   *
   * This does NOT release escrow. Releasing payment requires a
   * customer-confirmed handover signal (the customer-entered OTP issued
   * server-side) via verifyDelivery(). Self-reported GPS alone must never
   * satisfy the release gate.
   *
   * @param {object} params
   * @param {string} params.orderId    - Order UUID
   * @param {string} params.driverId   - Driver's Supabase user ID
   * @param {number} params.driverLat  - Driver's claimed latitude (audit only)
   * @param {number} params.driverLng  - Driver's claimed longitude (audit only)
   * @param {number} [params.geofenceRadiusM] - Per-request geofence radius in
   *   meters, overriding the env default when provided.
   * @returns {Promise<{autoConfirmed: boolean, message: string}>}
   */
  async geofenceAutoConfirm({ orderId, driverId, driverLat, driverLng, geofenceRadiusM }) {
    return measureExecution(
      "DeliveryVerificationService.geofenceAutoConfirm",
      async () => {
        // Fetch order including drop coords and current status
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

        // The release gate must never be satisfied by self-reported coordinates.
        // assertDriverAtDropoff() proves physical presence using only telemetry
        // that was authenticated at ingestion and bound to this driver/order.
        // The radius is clamped to the server default so a client-supplied
        // NaN/negative/oversized value can never bypass the distance check.
        const maxRadiusM = DELIVERY_GEOFENCE_RADIUS_KM * 1000;
        const radiusM =
          geofenceRadiusM != null &&
          Number.isFinite(geofenceRadiusM) &&
          geofenceRadiusM > 0
            ? Math.min(geofenceRadiusM, maxRadiusM)
            : maxRadiusM;
        await this.assertDriverAtDropoff(order, radiusM);

        // Record the geofence confirmation and the (non-authoritative) claimed
        // position for audit. This is a flag only — escrow is not released here.
        await this.orderRepository
          .updateOrder(orderId, {
            geofence_confirmed: true,
            geofence_confirmed_at: new Date().toISOString(),
            geofence_driver_lat: driverLat,
            geofence_driver_lng: driverLng,
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

  /**
   * Asserts that the assigned driver's latest telemetry point is fresh and
   * inside the geofence around the order's drop-off location.
   *
   * Only telemetry records that reference BOTH the order and the order's
   * assigned driver are considered. `driver_id` is stamped server-side from
   * the authenticated tracker/telemetry connection, so filtering on it — and
   * rejecting any point that does not belong to the assigned driver — stops
   * callers from substituting another driver's (or a fabricated) location.
   *
   * @param {object} order - Order row with id/driver_id/drop_lat/drop_lng.
   * @param {number} [radiusM] - Optional geofence radius in meters; falls back
   *   to the env default (DELIVERY_GEOFENCE_RADIUS_KM) when not provided.
   * @throws {DomainError} 400 missing drop coords, 503 store unavailable,
   *                       409 no/invalid/stale/out-of-range telemetry.
   */
  async assertDriverAtDropoff(order, radiusM) {
    if (!order.drop_lat || !order.drop_lng) {
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

    // Ownership + provenance: only telemetry for THIS driver on THIS order.
    // driver_id is stamped server-side from the authenticated connection.
    const latestTelemetry = await mongoDb
      .collection("telemetry")
      .find({ driver_id: order.driver_id, order_id: order.id })
      .sort({ server_received_at: -1 })
      .limit(1)
      .toArray();

    const telemetry = latestTelemetry?.[0];
    if (!telemetry || telemetry.driver_id !== order.driver_id) {
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

        const isRetryForStuckEscrow =
          order.status === "payment_released" &&
          ["funded", "release_failed"].includes(order.escrow_status);

        if (!isRetryForStuckEscrow) {
          await this.assertDriverAtDropoff(order);
        }

        let releaseTxHash = null;
        let escrowAlreadyReleased = false;

        // 1. Execute Blockchain Release FIRST to fail-safe if network errors occur
        if (
          order.escrow_status === "funded" ||
          order.escrow_status === "release_failed"
        ) {
          try {
            const releaseResult = await this.escrowReleaseFn(
              order.order_display_id,
            );
            if (releaseResult.txHash) {
              releaseTxHash = releaseResult.txHash;
            } else if (releaseResult.alreadyReleased) {
              escrowAlreadyReleased = true;
            } else {
              throw new Error("Escrow release returned no transaction hash");
            }
          } catch (releaseErr) {
            logger.error(
              "[escrow] Blockchain release failed for order",
              orderId,
              ":",
              releaseErr.message,
            );
            throw new DomainError(503, {
              error:
                "Blockchain escrow release failed. Payment cannot be processed. Please retry.",
              retryable: true,
            });
          }

          // Persist the confirmed release outcome immediately so a later
          // complete_trip_tx failure is recoverable: escrow_status becomes
          // 'released' before the RPC runs, so the SQL gate no longer blocks
          // retries with a NULL release hash.
          if (releaseTxHash || escrowAlreadyReleased) {
            const { error: persistReleaseErr } =
              await this.orderRepository.updateOrder(orderId, {
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
          // Release was confirmed in a previous attempt — reuse the persisted hash.
          releaseTxHash = order.release_tx_hash || null;
        } else {
          logger.info(
            `[escrow] Escrow not funded (status: ${order.escrow_status}) — skipping on-chain release.`,
          );
        }

        // 2. Execute Postgres RPC to complete the trip AFTER blockchain success
        let verifiedOrder;
        let tripData = null;

        if (!isRetryForStuckEscrow) {
          const guardResult = await this.orderRepository.updateOrderGuardStatus(
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
              "complete_trip_tx RPC failed:",
              rpcResult.error.message,
            );
            throw new DomainError(500, {
              error: "Failed to complete trip.",
              details: rpcResult.error.message,
            });
          }

          const verifyResult = await this.orderRepository.findOrderById(
            orderId,
            "status, escrow_status, escrow_release_attempts",
          );
          verifiedOrder = verifyResult.data;

          if (verifyResult.error || !verifiedOrder) {
            logger.error(
              `[verify-delivery] Failed to verify order status after RPC for order ${orderId}`,
            );
            throw new DomainError(500, {
              error: "Failed to verify order status after payment release.",
            });
          }

          if (verifiedOrder.status !== "payment_released") {
            logger.warn(
              `[verify-delivery] Order ${orderId} status changed to "${verifiedOrder.status}" — payment was not released.`,
            );
            throw new DomainError(409, {
              error:
                "Order status changed during processing. Payment was not released.",
            });
          }

          await this.completeDeliveryOtp({
            otpRecordId: otpRecord.id,
            orderId,
          });
        } else {
          logger.info(
            `[verify-delivery] Retry for stuck escrow for order ${orderId} by driver ${driverId}`,
          );
        }

        // The trip is complete (payment_released) — kill any active public
        // tracking tokens so a shared link can no longer broadcast the driver's
        // live location. Best-effort: revokeAllForOrder never throws.
        await this.trackingTokenService?.revokeAllForOrder(
          order.order_display_id,
        );

        // --- Fire FCM push to driver: "Payment Released ✓" ---
        const resolvedDriverIdForPush = tripData?.driver_id || order.driver_id;
        if (resolvedDriverIdForPush) {
          const amountInr = order.total_amount
            ? `₹${(order.total_amount / 100).toFixed(0)}`
            : "your amount";
          sendPushNotification(
            resolvedDriverIdForPush,
            "✅ Payment Released",
            `Payment Released ✓ ${amountInr} credited for order ${order.order_display_id}`,
            "payment_released",
            {
              order_display_id: order.order_display_id,
              release_tx_hash: releaseTxHash || "",
              amount_paisa: String(order.total_amount || 0),
            },
          ).catch((err) =>
            logger.warn("[FCM] Payment release push failed:", err.message),
          );
        }

        let escrowUpdateFailed = false;
        if (releaseTxHash || escrowAlreadyReleased) {
          const { error: releaseUpdateErr } =
            await this.orderRepository.updateOrder(orderId, {
              escrow_status: "released",
              escrow_release_error: null,
              escrow_released_at: new Date().toISOString(),
              release_tx_hash: releaseTxHash,
            });

          if (releaseUpdateErr) {
            logger.error(
              "[escrow] Release confirmed but persistence failed:",
              releaseUpdateErr.message,
            );
            escrowUpdateFailed = true;
          } else {
            const resolvedDriverId = tripData?.driver_id || order.driver_id;
            const resolvedDisplayId =
              tripData?.order_display_id || order.order_display_id;
            if (resolvedDriverId) {
              const { error: walletErr } =
                await this.orderRepository.updateWalletTransaction(
                  resolvedDriverId,
                  resolvedDisplayId,
                  { description: `Escrow payout for ${resolvedDisplayId}` },
                );

              if (walletErr) {
                logger.error(
                  "[wallet] Failed to persist escrow payout:",
                  walletErr.message,
                );
              }
            }
          }
        }

        return { escrowUpdateFailed };
      },
    );
  }
}
