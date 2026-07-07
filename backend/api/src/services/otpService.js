import { redisClient } from '../config/db.js';
import logger from '../middleware/logger.js';

const OTP_TTL_SECONDS = 300;
const OTP_LENGTH = 4;
const OTP_RATE_LIMIT_WINDOW = 60;
const OTP_MAX_PER_WINDOW = 3;

async function checkOtpRateLimit(phone) {
  if (!redisClient) return true;
  const key = 'otp:rate:' + phone;
  const count = await redisClient.incr(key);
  if (count === 1) await redisClient.expire(key, OTP_RATE_LIMIT_WINDOW);
  return count <= OTP_MAX_PER_WINDOW;
}

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
    return Boolean(process.env.DRIVER_LOGIN_OTP) && otp === process.env.DRIVER_LOGIN_OTP;
  }
  const stored = await redisClient.get(`otp:${phone}`);
  if (!stored || stored !== otp) return false;
  await redisClient.del(`otp:${phone}`);
  return true;
}
