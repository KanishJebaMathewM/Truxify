import crypto from 'crypto';
import { redisClient } from '../../config/db.js';
import logger from '../../middleware/logger.js';
import {
  sendDeliveryOtpNotification,
  storeDeliveryOtp,
  getActiveDeliveryOtp,
} from '../notificationService.js';

export const OTP_TTL_MINUTES = parseInt(process.env.OTP_TTL_MINUTES || '15', 10);
export const OTP_MAX_FAILED_ATTEMPTS = parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10);
export const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES || '30', 10);
const IN_MEMORY_OTP_MAP_MAX_SIZE = parseInt(process.env.IN_MEMORY_OTP_MAP_MAX_SIZE || '10000', 10);
export const DELIVERY_OTP_READY_STATUSES = new Set(['arriving']);

const inMemoryOtpFailedAttempts = new Map();

/**
 * Folds any attempts accumulated in the in-memory fallback back into Redis
 * when Redis is reachable again. Without this, a Redis outage would split the
 * brute-force budget across two stores: failures counted in memory during the
 * outage were never reflected in Redis after recovery, so an attacker who
 * exhausted the in-memory budget could start fresh against Redis (and vice
 * versa — a Redis-side lock could be shadowed by a stale in-memory record).
 *
 * Safe to call on every path: it is a no-op when there is no pending fallback
 * record, and if Redis is still unreachable it keeps the in-memory record so
 * the fallback remains authoritative until Redis truly recovers.
 */
async function reconcileInMemoryIntoRedis(orderId) {
  const record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record) return;
  if (record.count <= 0 && !record.lockedUntil) {
    inMemoryOtpFailedAttempts.delete(orderId);
    return;
  }
  try {
    const countKey = `otp_failed_count:${orderId}`;
    const lockKey = `otp_lockout:${orderId}`;
    if (record.count > 0) {
      const merged = await redisClient.incrby(countKey, record.count);
      await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
      if (merged >= OTP_MAX_FAILED_ATTEMPTS) {
        await redisClient.set(lockKey, '1', 'EX', OTP_LOCKOUT_MINUTES * 60);
      }
    }
    if (record.lockedUntil) {
      const remainingSec = Math.max(1, Math.ceil((record.lockedUntil - Date.now()) / 1000));
      await redisClient.set(lockKey, '1', 'EX', remainingSec);
    }
  } catch (err) {
    logger.error('[OTP] Redis error during in-memory reconciliation, keeping memory fallback:', err.message);
    return;
  }
  inMemoryOtpFailedAttempts.delete(orderId);
}

export async function checkOtpLockout(orderId) {
  if (redisClient) {
    try {
      // Fold any offline attempts back into Redis now that it is reachable, so
      // the authoritative (Redis) state is not skewed by the fallback.
      await reconcileInMemoryIntoRedis(orderId);
      const lockKey = `otp_lockout:${orderId}`;
      const isLocked = await redisClient.get(lockKey);
      return !!isLocked;
    } catch (err) {
      logger.error('[OTP] Redis error in checkOtpLockout, falling back to memory:', err.message);
    }
  }
  const record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record || !record.lockedUntil) return false;
  if (Date.now() >= record.lockedUntil) {
    inMemoryOtpFailedAttempts.delete(orderId);
    return false;
  }
  return true;
}

export async function recordOtpFailure(orderId) {
  if (redisClient) {
    try {
      // Fold offline attempts back into Redis before recording the new one so
      // the brute-force budget stays contiguous across a Redis resync.
      await reconcileInMemoryIntoRedis(orderId);
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;

      const count = await redisClient.incr(countKey);
      await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
      if (count >= OTP_MAX_FAILED_ATTEMPTS) {
        await redisClient.set(lockKey, '1', 'EX', OTP_LOCKOUT_MINUTES * 60);
      }
      return count;
    } catch (err) {
      logger.error('[OTP] Redis error in recordOtpFailure, falling back to memory:', err.message);
    }
  }

  if (inMemoryOtpFailedAttempts.size >= IN_MEMORY_OTP_MAP_MAX_SIZE) {
    const oldestKey = inMemoryOtpFailedAttempts.keys().next().value;
    inMemoryOtpFailedAttempts.delete(oldestKey);
  }

  let record = inMemoryOtpFailedAttempts.get(orderId);
  if (!record) {
    record = { count: 0, lockedUntil: null };
    inMemoryOtpFailedAttempts.set(orderId, record);
  }
  record.count += 1;
  if (record.count >= OTP_MAX_FAILED_ATTEMPTS) {
    record.lockedUntil = Date.now() + OTP_LOCKOUT_MINUTES * 60 * 1000;
  }
  return record.count;
}

export async function clearOtpState(orderId) {
  if (redisClient) {
    try {
      const countKey = `otp_failed_count:${orderId}`;
      // Never delete otp_lockout — the lockout key self-expires via its own
      // TTL, and clearing it here would let resend/regenerate paths reset the
      // anti-brute-force guard on demand.
      await redisClient.del(countKey);
      // Drop the in-memory fallback so it cannot drift from the cleared Redis
      // state after a resync.
      inMemoryOtpFailedAttempts.delete(orderId);
      return;
    } catch (err) {
      logger.error('[OTP] Redis error in clearOtpState, falling back to memory:', err.message);
    }
  }
  const record = inMemoryOtpFailedAttempts.get(orderId);
  if (record) {
    record.count = 0;
    if (record.lockedUntil) {
      // Respect the lockout window; the record is dropped when it expires.
      return;
    }
  }
  inMemoryOtpFailedAttempts.delete(orderId);
}

export class OrderNotificationService {
  constructor(orderRepository) {
    this.orderRepository = orderRepository;
  }

  /**
   * Generate, persist, and dispatch an order-related notification.
   *
   * @param {Object} params
   * @param {'delivery_otp_in_transit'|'delivery_otp_resend'} params.type
   * @param {string} params.orderId
   * @param {string} params.orderDisplayId
   * @param {string} params.customerId
   * @returns {Promise<{otp: string|null, notified: boolean}>}
   */
  async sendOrderNotification({ type, orderId, orderDisplayId, customerId }) {
    if (await checkOtpLockout(orderId)) {
      logger.warn(`[OTP] Rejected OTP issuance for locked order ${orderId}`);
      return { otp: null, notified: false };
    }

    const activeOtp = await getActiveDeliveryOtp(orderId);
    if (type === 'delivery_otp_in_transit') {
      if (activeOtp) {
        logger.warn(`[OTP] Driver attempted OTP regeneration for order ${orderId}`);
        return { otp: null, notified: false };
      }
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const stored = await storeDeliveryOtp(orderId, otp, OTP_TTL_MINUTES);
    if (!stored) return { otp: null, notified: false };

    // Only a fresh issuance after the previous OTP expired may reset the
    // failure counter; an active-OTP resend keeps it so repeated resends
    // cannot zero out the brute-force budget.
    if (!activeOtp) await clearOtpState(orderId);

    const notifResult = await sendDeliveryOtpNotification(customerId, orderDisplayId, otp);

    if (!notifResult.success) {
      logger.warn(`[OrderNotification] Delivery OTP notification failed for order ${orderDisplayId} — FCM error: ${notifResult.fcm?.error || 'unknown'}`);
      if (type === 'delivery_otp_in_transit') {
        await this.orderRepository.updateOrder(orderId, {
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { otp, notified: notifResult.success };
  }
}
