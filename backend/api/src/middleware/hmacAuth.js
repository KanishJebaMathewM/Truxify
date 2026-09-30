import { authConfig } from '../config/authConfig.js';
import { metrics } from '../services/metricsService.js';
import { AuditLogger } from '../services/auditLogger.js';
import { calculateHmacSignature, safeCompare } from '../utils/cryptoUtils.js';

// HMAC Signature verification middleware for integrity protection.
export const requireHmacSignature = (req, res, next) => {
  if (!authConfig.requireHmac) return next();

  const signature = req.headers[authConfig.signatureHeaderName];
  const timestamp = req.headers[authConfig.timestampHeaderName];

  if (!signature || !timestamp) {
    AuditLogger.logFailure(req, 'Missing HMAC headers', 'missing_hmac_headers');
    return res.status(401).json({ error: 'Unauthorized: Missing HMAC signature or timestamp' });
  }

  // Validate Timestamp Freshness (Replay Attack Prevention)
  const clientTime = parseInt(timestamp, 10);
  const currentTime = Date.now();

  if (isNaN(clientTime) || Math.abs(currentTime - clientTime) > authConfig.signatureMaxAgeMs) {
    AuditLogger.logFailure(req, 'Timestamp out of range (possible replay attack)', 'invalid_timestamp');
    return res.status(401).json({ error: 'Unauthorized: Timestamp expired or invalid' });
  }

  const rawKey = req.apiKeyMetadata?.rawKey;
  if (!rawKey) {
    return res.status(500).json({ error: 'Internal Error: Key unavailable for HMAC verification' });
  }

  const computedSignature = calculateHmacSignature(rawKey, timestamp, req.body || '');

  if (!safeCompare(signature, computedSignature)) {
    metrics.increment('hmacFailure');
    AuditLogger.logFailure(req, 'Invalid HMAC Signature', 'hmac_mismatch');
    return res.status(401).json({ error: 'Unauthorized: Invalid request signature' });
  }

  next();
};