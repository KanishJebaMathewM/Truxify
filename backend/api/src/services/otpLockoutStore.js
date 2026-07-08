import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const OTP_MAX_FAILED_ATTEMPTS = parseInt(process.env.OTP_MAX_FAILED_ATTEMPTS || '5', 10);
const OTP_LOCKOUT_MINUTES = parseInt(process.env.OTP_LOCKOUT_MINUTES || '30', 10);
const MAX_MAP_SIZE = parseInt(process.env.IN_MEMORY_OTP_MAP_MAX_SIZE || '10000', 10);

export const inMemoryOtpFailedAttempts = new Map();

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
  if (inMemoryOtpFailedAttempts.size >= MAX_MAP_SIZE) {
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
