import crypto from 'crypto';
import { redisClient } from '../config/db.js';

const HMAC_SECRET = process.env.HMAC_SECRET || 'default-hmac-secret-key';
const MAX_TIMESTAMP_DIFF_MS = 5 * 60 * 1000; // 5 minutes tolerance

const fallbackNonces = new Map();

// Cleans up expired nonces from the fallback map
const cleanupFallbackNonces = () => {
  const now = Date.now();
  for (const [nonce, expiresAt] of fallbackNonces.entries()) {
    if (now > expiresAt) {
      fallbackNonces.delete(nonce);
    }
  }
};

export const isNonceValid = async (nonce) => {
  if (redisClient) {
    try {
      const key = `hmac:nonce:${nonce}`;
      const result = await redisClient.set(key, '1', 'NX', 'PX', MAX_TIMESTAMP_DIFF_MS);
      return result === 'OK';
    } catch (err) {
      // If Redis fails, fall back to in-memory check to prevent blocking traffic
    }
  }
  
  cleanupFallbackNonces();
  if (fallbackNonces.has(nonce)) {
    return false;
  }
  fallbackNonces.set(nonce, Date.now() + MAX_TIMESTAMP_DIFF_MS);
  return true;
};

export const isTimestampValid = (timestamp) => {
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  return Math.abs(currentTime - requestTime) <= MAX_TIMESTAMP_DIFF_MS;
};

export const generateSignature = (payload, timestamp, nonce) => {
  const dataToSign = `${timestamp}.${nonce}.${payload}`;
  return crypto.createHmac('sha256', HMAC_SECRET).update(dataToSign).digest('hex');
};

export const verifySignature = (signature, payload, timestamp, nonce) => {
  const expectedSignature = generateSignature(payload, timestamp, nonce);
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  } catch {
    return false;
  }
};

const hmacService = {
  isNonceValid,
  isTimestampValid,
  verifySignature,
  generateSignature,
};

export default hmacService;
