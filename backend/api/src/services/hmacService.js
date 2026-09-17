import crypto from 'crypto';

const HMAC_SECRET = process.env.HMAC_SECRET || 'default-hmac-secret-key';
const MAX_TIMESTAMP_DIFF_MS = 5 * 60 * 1000; // 5 minutes tolerance
const usedNonces = new Set();

// In production, replace this in-memory Set with Redis to support multi-instance deployments
export const isNonceValid = (nonce) => {
  if (usedNonces.has(nonce)) {
    return false;
  }
  usedNonces.add(nonce);
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
