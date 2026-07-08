import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';

const OTP_TTL_SECONDS = 300;
const OTP_LENGTH = 6;

export async function generateAndStoreOtp(phone) {
  if (!redisClient) {
    logger.warn('[otp] Redis not available, cannot generate OTP.');
    return null;
  }
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    logger.warn('[otp] Invalid phone number provided.');
    return null;
  }
  const min = Math.pow(10, OTP_LENGTH - 1);
  const max = Math.pow(10, OTP_LENGTH) - 1;
  const otp = String(crypto.randomInt(min, max + 1));
  await redisClient.set(`otp:${phone}`, otp, 'EX', OTP_TTL_SECONDS);
  logger.info(`[otp] OTP generated for ${phone}`);
  return otp;
}

export async function verifyOtp(phone, otp) {
  if (!phone || typeof phone !== 'string' || !phone.trim()) {
    logger.warn('[otp] Invalid phone number provided for verification.');
    return false;
  }
  if (!redisClient) {
    if (process.env.NODE_ENV === 'production') {
      logger.error('[otp] Redis unavailable in production — rejecting OTP verification.');
      return false;
    }
    logger.warn('[otp] Redis not available, cannot verify OTP.');
    return false;
  }
  const stored = await redisClient.get(`otp:${phone}`);
  if (!stored || stored !== otp) return false;
  await redisClient.del(`otp:${phone}`);
  return true;
}
