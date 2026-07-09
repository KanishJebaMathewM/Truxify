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

export async function checkOtpLockout(orderId) {
  if (redisClient) {
    try {
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
      const countKey = `otp_failed_count:${orderId}`;
      const lockKey = `otp_lockout:${orderId}`;

      const count = await redisClient.incr(countKey);
      if (count === 1) await redisClient.expire(countKey, OTP_LOCKOUT_MINUTES * 60);
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
      const lockKey = `otp_lockout:${orderId}`;
      await redisClient.del(countKey, lockKey);
      return;
    } catch (err) {
      logger.error('[OTP] Redis error in clearOtpState, falling back to memory:', err.message);
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
    if (type === 'delivery_otp_in_transit') {
      const activeOtp = await getActiveDeliveryOtp(orderId);
      if (activeOtp) {
        logger.warn(`[OTP] Driver attempted OTP regeneration for order ${orderId}`);
        return { otp: null, notified: false };
      }
    }

    const otp = crypto.randomInt(100000, 1000000).toString();
    const stored = await storeDeliveryOtp(orderId, otp, OTP_TTL_MINUTES);
    if (!stored) return { otp: null, notified: false };

    await clearOtpState(orderId);

    const notifResult = await sendDeliveryOtpNotification(customerId, orderDisplayId, otp);

    if (!notifResult.success) {
      logger.warn(`[OrderNotification] Delivery OTP notification failed for order ${orderDisplayId} — FCM error: ${notifResult.fcm?.error || 'unknown'}`);
      if (type === 'delivery_otp_in_transit') {
        await this.orderRepository.updateOrder(orderId, {
          notification_failed: true,
          updated_at: new Date().toISOString(),
        });
      }
    }

    return { otp, notified: notifResult.success };
  }
}
