import crypto from 'crypto';
import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const OTP_TTL_SECONDS = 300;
const OTP_LENGTH = 4;

function hashOtp(otp) {
  return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

export async function generateAndStoreOtp(phone) {
  if (!redisClient) {
    logger.warn('[otp] Redis not available, cannot generate OTP.');
    return null;
  }
  const otp = String(crypto.randomInt(1000, 10000)).slice(0, OTP_LENGTH);
  await redisClient.set(`otp:${phone}`, hashOtp(otp), 'EX', OTP_TTL_SECONDS);
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
  if (!stored || stored !== hashOtp(otp)) return false;
  await redisClient.del(`otp:${phone}`);
  return true;
}
