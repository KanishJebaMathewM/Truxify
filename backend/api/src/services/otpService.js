import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const OTP_TTL_SECONDS = 300;
const OTP_LENGTH = 4;

export async function generateAndStoreOtp(phone) {
  if (!redisClient) {
    logger.warn('[otp] Redis not available, cannot generate OTP.');
    return null;
  }
  const otp = String(Math.floor(1000 + Math.random() * 9000)).slice(0, OTP_LENGTH);
  await redisClient.set(`otp:${phone}`, otp, 'EX', OTP_TTL_SECONDS);
  logger.info(`[otp] OTP generated for ${phone}`);
  return otp;
}

export async function verifyOtp(phone, otp) {
  if (!redisClient) {
    logger.warn('[otp] Redis not available, cannot verify OTP.');
    return false;
  }
  const stored = await redisClient.get(`otp:${phone}`);
  if (!stored || stored !== otp) return false;
  await redisClient.del(`otp:${phone}`);
  return true;
}
