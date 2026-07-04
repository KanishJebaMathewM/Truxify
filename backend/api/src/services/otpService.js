import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';
import crypto from 'crypto';

const OTP_TTL_SECONDS = 300;
const OTP_LENGTH = 4;

export async function generateAndStoreOtp(phone) {
  if (!redisClient) {
    logger.warn('[otp] Redis not available, cannot generate OTP.');
    return null;
  }
  const otp = String(crypto.randomInt(1000, 10000));
  await redisClient.set(`otp:${phone}`, otp, 'EX', OTP_TTL_SECONDS);
  logger.info(`[otp] OTP generated for ${phone}`);
  return otp;
}

export async function verifyOtp(phone, otp) {
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
