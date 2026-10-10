// Cryptographic primitives for timing-safe comparison and HMAC.
import crypto from 'crypto';

/**
 * Perform a constant-time comparison of two strings to prevent timing attacks.
 */
export function safeCompare(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') {
    return false;
  }

  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Fill buffer with same size dummy comparison to prevent length timing leaks
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }

  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Hashes an API Key using SHA-256 for safe storage or caching lookups.
 */
export function hashApiKey(key, salt = '') {
  return crypto
    .createHash('sha256')
    .update(`${key}${salt}`)
    .digest('hex');
}

/**
 * Generates a cryptographically strong random API Key.
 */
export function generateSecureApiKey(prefix = 'sk_live_') {
  const randomBytes = crypto.randomBytes(24).toString('hex');
  return `${prefix}${randomBytes}`;
}

/**
 * Computes HMAC-SHA256 signature for payload verification.
 */
export function calculateHmacSignature(secret, timestamp, payload) {
  const dataToSign = `${timestamp}.${typeof payload === 'object' ? JSON.stringify(payload) : payload || ''}`;
  return crypto
    .createHmac('sha256', secret)
    .update(dataToSign)
    .digest('hex');
}

/**
 * Anonymizes IP or Key for GDPR compliant security logging.
 */
export function maskSecret(secret, visibleChars = 4) {
  if (!secret || secret.length <= visibleChars * 2) return '***';
  const start = secret.slice(0, visibleChars);
  const end = secret.slice(-visibleChars);
  return `${start}...${end}`;
}