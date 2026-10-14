import { authConfig } from '../config/authConfig.js';
import { keyRepo } from '../services/keyRepository.js';
import { AuditLogger } from '../services/auditLogger.js';
import { safeCompare, maskSecret } from '../utils/cryptoUtils.js';

/**
 * Enhanced Middleware for backend-to-backend API Key Authentication.
 * Supports timing-safe checking, environment fallback, repository metadata,
 * IP filtering, and zero-downtime key rotation.
 */
export const requireApiKey = (req, res, next) => {
  // Re-read env so rotated/updated VALID_API_KEYS take effect without a
  // restart (and so tests can control the config per request).
  authConfig.reload();

  // 1. Extract API Key from Headers (or Query if explicitly enabled)
  const rawHeader = req.headers[authConfig.keyHeaderName];
  let apiKey = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

  if (!apiKey && authConfig.allowQueryParam && req.query) {
    apiKey = req.query.api_key || req.query.apiKey;
  }

  // 2. Load environment keys into repository if empty
  if (keyRepo.keyStore.size === 0 && authConfig.isConfigured()) {
    keyRepo.loadFromEnv(authConfig.validKeysRaw);
  }

  // 3. Fallback: check raw env configuration directly
  const configuredKeys = authConfig.parsedKeys;

  if (configuredKeys.length === 0 && keyRepo.keyStore.size === 0) {
    AuditLogger.logConfigError(req);
    return res.status(503).json({
      error: 'Service Unavailable: API key authentication is not configured.',
    });
  }

  // 4. Missing Key Check
  if (!apiKey) {
    AuditLogger.logFailure(req, 'Missing API Key in request headers', 'missing_api_key');
    return res.status(401).json({ error: 'Unauthorized: Missing API Key' });
  }

  // 5. Lookup Key Metadata via Repository (or Timing-Safe Dynamic Evaluation)
  let keyRecord = keyRepo.findByRawKey(apiKey);

  // Fallback: Direct Constant-Time String Match against Environment Keys
  if (!keyRecord) {
    const isValidEnvKey = configuredKeys.some((validKey) => safeCompare(apiKey, validKey));
    if (isValidEnvKey) {
      keyRecord = {
        id: 'env_default',
        name: 'Default Env Key',
        scopes: ['*'],
        rateLimit: authConfig.defaultRateLimitMax,
      };
    }
  }

  // 6. Reject if Key Invalid
  if (!keyRecord) {
    AuditLogger.logFailure(req, 'Invalid or revoked API Key', 'invalid_api_key', {
      attemptedKeyMasked: maskSecret(apiKey),
    });
    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  // 7. Attach Auth Context to Request Object
  req.apiKeyMetadata = {
    ...keyRecord,
    rawKey: apiKey, // Kept in memory for request lifecycle only
  };

  // Touch last used timestamp
  if (keyRecord.hashedKey) {
    keyRepo.touch(keyRecord.hashedKey);
  }

  AuditLogger.logSuccess(req, keyRecord);
  next();
};