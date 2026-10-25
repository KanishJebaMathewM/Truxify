import Redis from 'ioredis';
import crypto from 'crypto';

const MIN_HMAC_SECRET_BYTES = 32;
const MAX_TIMESTAMP_DIFF_MS = 5 * 60 * 1000;
const NONCE_TTL_MS = MAX_TIMESTAMP_DIFF_MS;
const NONCE_TTL_SECONDS = 5 * 60;
const NONCE_KEY_PREFIX = 'truxify:hmac:nonce:';
const MAX_NONCE_ENTRIES = 10_000;
const MAX_NONCE_LENGTH = 256;

let redisClient;
const usedNonces = new Map();

const getHmacSecret = () => {
  const secret = process.env.HMAC_SECRET;
  if (!secret) {
    throw new Error('HMAC_SECRET is required; refusing to sign or verify HMAC requests without a configured secret.');
  }

  if (Buffer.byteLength(secret, 'utf8') < MIN_HMAC_SECRET_BYTES) {
    throw new Error(`HMAC_SECRET must contain at least ${MIN_HMAC_SECRET_BYTES} bytes.`);
  }

  return secret;
};

if (process.env.NODE_ENV === 'production') {
  getHmacSecret();
}

const getRedisClient = () => {
  const redisUrl = process.env.HMAC_NONCE_REDIS_URL || process.env.REDIS_URL;
  if (!redisUrl) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Redis is required for distributed HMAC nonce replay protection in production.');
    }
    return null;
  }

  if (!redisClient) {
    redisClient = new Redis(redisUrl);
  }

  return redisClient;
};

const purgeExpiredNonces = (now = Date.now()) => {
  for (const [nonce, expiresAt] of usedNonces) {
    if (expiresAt <= now) {
      usedNonces.delete(nonce);
    }
  }
};

export const isNonceValid = async (nonce) => {
  if (typeof nonce !== 'string' || nonce.length === 0 || nonce.length > MAX_NONCE_LENGTH) {
    return false;
  }

  const client = getRedisClient();
  if (client) {
    const result = await client.set(
      `${NONCE_KEY_PREFIX}${nonce}`,
      '1',
      'NX',
      'EX',
      NONCE_TTL_SECONDS
    );
    return result === 'OK';
  }

  const now = Date.now();
  purgeExpiredNonces(now);

  if (usedNonces.has(nonce)) {
    return false;
  }

  if (usedNonces.size >= MAX_NONCE_ENTRIES) {
    return false;
  }

  usedNonces.set(nonce, now + NONCE_TTL_MS);
  return true;
};

export const isTimestampValid = (timestamp) => {
  const requestTime = parseInt(timestamp, 10);
  const currentTime = Date.now();
  return Math.abs(currentTime - requestTime) <= MAX_TIMESTAMP_DIFF_MS;
};

export const generateSignature = (payload, timestamp, nonce) => {
  const dataToSign = `${timestamp}.${nonce}.${payload}`;
  return crypto.createHmac('sha256', getHmacSecret()).update(dataToSign).digest('hex');
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
