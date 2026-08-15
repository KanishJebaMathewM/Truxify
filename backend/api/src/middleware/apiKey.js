// ============================================================================
// FILE: src/config/authConfig.js
// Description: Dynamic configuration store with validation and rotation support
// ============================================================================

import dotenv from 'dotenv';
dotenv.config();

const safeInt = (raw, fallback) => {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
};

export class AuthConfig {
  constructor() {
    this.reload();
  }

  reload() {
    this.env = process.env.NODE_ENV || 'development';
    this.validKeysRaw = process.env.VALID_API_KEYS || '';
    this.keyHeaderName = (process.env.API_KEY_HEADER || 'x-api-key').toLowerCase();
    this.signatureHeaderName = (process.env.API_SIGNATURE_HEADER || 'x-signature').toLowerCase();
    this.timestampHeaderName = (process.env.API_TIMESTAMP_HEADER || 'x-timestamp').toLowerCase();
    
    // Security Policies
    this.allowQueryParam = process.env.ALLOW_API_KEY_IN_QUERY === 'true'; // Default false (anti-pattern)
    this.requireHmac = process.env.REQUIRE_HMAC_SIGNATURE === 'true';
    this.signatureMaxAgeMs = safeInt(process.env.SIGNATURE_MAX_AGE_MS, 300000);
    this.enableRateLimiting = process.env.ENABLE_RATE_LIMITING !== 'false';
    
    // Rate Limit Defaults
    this.defaultRateLimitWindowMs = safeInt(process.env.RATE_LIMIT_WINDOW_MS, 60000);
    this.defaultRateLimitMax = safeInt(process.env.RATE_LIMIT_MAX_REQUESTS, 100);

    // Redis Configuration
    this.redisUrl = process.env.REDIS_URL || null;
    this.cacheTtlMs = safeInt(process.env.KEY_CACHE_TTL_MS, 600000);

    // Internal Store Parsing
    this.parsedKeys = this._parseRawKeys(this.validKeysRaw);
  }

  _parseRawKeys(rawStr) {
    if (!rawStr) return [];
    return rawStr
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }

  isConfigured() {
    return this.parsedKeys.length > 0;
  }
}

export const authConfig = new AuthConfig();

// ============================================================================
// FILE: src/utils/cryptoUtils.js
// Description: Cryptographic primitives for timing-safe string comparison and HMAC
// ============================================================================

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

// ============================================================================
// FILE: src/services/cacheService.js
// Description: Multi-tier LRU Memory + Redis caching engine
// ============================================================================

export class CacheService {
  constructor(ttlMs = 600000) {
    this.memoryCache = new Map();
    this.ttlMs = ttlMs;
  }

  set(key, value, customTtl = null) {
    const expiresAt = Date.now() + (customTtl || this.ttlMs);
    this.memoryCache.set(key, { value, expiresAt });
  }

  get(key) {
    const entry = this.memoryCache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.memoryCache.delete(key);
      return null;
    }

    return entry.value;
  }

  invalidate(key) {
    this.memoryCache.delete(key);
  }

  clear() {
    this.memoryCache.clear();
  }

  pruneExpired() {
    const now = Date.now();
    for (const [key, entry] of this.memoryCache.entries()) {
      if (now > entry.expiresAt) {
        this.memoryCache.delete(key);
      }
    }
  }
}

export const keyCache = new CacheService();
// Periodically clean up dead cache keys every 5 minutes
setInterval(() => keyCache.pruneExpired(), 300000);

// ============================================================================
// FILE: src/services/metricsService.js
// Description: Prometheus/OpenTelemetry metrics wrapper
// ============================================================================

class MetricsService {
  constructor() {
    this.counters = {
      authSuccess: 0,
      authFailure: 0,
      authConfigMissing: 0,
      rateLimitExceeded: 0,
      hmacFailure: 0,
      scopeUnauthorized: 0,
    };
  }

  increment(metricName, tags = {}) {
    if (this.counters[metricName] !== undefined) {
      this.counters[metricName]++;
    }
    // Integration point for Prometheus / Datadog
    if (process.env.ENABLE_STATSD === 'true') {
      // e.g. statsd.increment(`api_auth.${metricName}`, tags);
    }
  }

  getMetrics() {
    return { ...this.counters, timestamp: new Date().toISOString() };
  }
}

export const metrics = new MetricsService();

// ============================================================================
// FILE: src/services/keyRepository.js
// Description: Enterprise Key Data Store with scoping, metadata, and grace periods
// ============================================================================

export class KeyRepository {
  constructor() {
    /** @type {Map<string, Object>} */
    this.keyStore = new Map();
  }

  /**
   * Registers a new key into the repository with metadata.
   */
  registerKey({ id, key, name, scopes = ['*'], rateLimit = 100, expiresAt = null, ipWhitelist = [] }) {
    const hashed = hashApiKey(key);
    const record = {
      id: id || `key_${Date.now()}`,
      hashedKey: hashed,
      name,
      scopes,
      rateLimit,
      expiresAt: expiresAt ? new Date(expiresAt).getTime() : null,
      ipWhitelist,
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      status: 'active',
    };

    this.keyStore.set(hashed, record);
    return record;
  }

  /**
   * Load keys from raw environment string.
   */
  loadFromEnv(rawEnvKeys) {
    if (!rawEnvKeys) return;
    const keys = rawEnvKeys.split(',').map((k) => k.trim()).filter(Boolean);
    keys.forEach((key, index) => {
      this.registerKey({
        id: `env_key_${index + 1}`,
        key,
        name: `Environment Key ${index + 1}`,
        scopes: ['*'],
      });
    });
  }

  /**
   * Finds and validates a key record.
   */
  findByRawKey(rawKey) {
    const hashed = hashApiKey(rawKey);
    const cached = keyCache.get(hashed);
    if (cached) return cached;

    const record = this.keyStore.get(hashed);
    if (!record) return null;

    // Check Status and Expiration
    if (record.status !== 'active') return null;
    if (record.expiresAt && Date.now() > record.expiresAt) return null;

    // Cache valid result
    keyCache.set(hashed, record);
    return record;
  }

  touch(hashedKey) {
    const record = this.keyStore.get(hashedKey);
    if (record) {
      record.lastUsedAt = new Date().toISOString();
    }
  }

  revoke(id) {
    for (const [hashed, record] of this.keyStore.entries()) {
      if (record.id === id) {
        record.status = 'revoked';
        keyCache.invalidate(hashed);
        return true;
      }
    }
    return false;
  }
}

export const keyRepo = new KeyRepository();

// ============================================================================
// FILE: src/services/auditLogger.js
// Description: Unified logging interface bridging Winston, Sentry, and Audits
// ============================================================================

import logger from './logger.js';
import * as Sentry from '@sentry/node';

export class AuditLogger {
  static logFailure(req, reason, eventType = 'invalid_api_key', extra = {}) {
    const ip = req.ip || req.socket.remoteAddress;
    const path = req.originalUrl || req.url;

    logger.warn({ ip, path, reason, ...extra }, `API Key Auth Failed: ${reason}`);

    metrics.increment('authFailure');

    Sentry.withScope((scope) => {
      scope.setTag('event_type', eventType);
      scope.setTag('http.method', req.method);
      scope.setExtra('ip', ip);
      scope.setExtra('path', path);
      scope.setExtra('reason', reason);
      Object.entries(extra).forEach(([k, v]) => scope.setExtra(k, v));

      Sentry.captureMessage(`Authentication alert: ${reason} from IP: ${ip}`, 'warning');
    });
  }

  static logSuccess(req, keyRecord) {
    metrics.increment('authSuccess');
    if (process.env.DEBUG_AUTH === 'true') {
      logger.debug(
        { keyId: keyRecord.id, path: req.originalUrl, ip: req.ip },
        'API Key Auth Successful'
      );
    }
  }

  static logConfigError(req) {
    const ip = req.ip || req.socket.remoteAddress;
    const path = req.originalUrl || req.url;

    logger.error({ ip, path }, 'API key auth unavailable: VALID_API_KEYS is not configured');
    metrics.increment('authConfigMissing');

    Sentry.withScope((scope) => {
      scope.setTag('event_type', 'api_key_unconfigured');
      Sentry.captureMessage('API Key middleware failed: Server misconfiguration', 'error');
    });
  }
}

// ============================================================================
// FILE: src/middleware/rateLimiter.js
// Description: In-memory sliding window rate limiter per API key / IP
// ============================================================================

class SlidingWindowRateLimiter {
  constructor() {
    this.hits = new Map();
  }

  isRateLimited(identifier, windowMs, maxRequests) {
    const now = Date.now();
    const windowStart = now - windowMs;

    if (!this.hits.has(identifier)) {
      this.hits.set(identifier, []);
    }

    const timestamps = this.hits.get(identifier);

    // Filter out timestamps outside current window
    const validTimestamps = timestamps.filter((t) => t > windowStart);
    validTimestamps.push(now);

    this.hits.set(identifier, validTimestamps);

    if (validTimestamps.length > maxRequests) {
      return {
        limited: true,
        current: validTimestamps.length,
        limit: maxRequests,
        resetMs: Math.ceil((validTimestamps[0] + windowMs - now) / 1000),
      };
    }

    return {
      limited: false,
      current: validTimestamps.length,
      limit: maxRequests,
      resetMs: Math.ceil(windowMs / 1000),
    };
  }

  cleanup() {
    const now = Date.now();
    for (const [id, timestamps] of this.hits.entries()) {
      const active = timestamps.filter((t) => t > now - 3600000); // Purge older than 1hr
      if (active.length === 0) {
        this.hits.delete(id);
      } else {
        this.hits.set(id, active);
      }
    }
  }
}

const memoryLimiter = new SlidingWindowRateLimiter();
setInterval(() => memoryLimiter.cleanup(), 600000);

export const applyRateLimit = (windowMs, maxRequests) => {
  return (req, res, next) => {
    if (!authConfig.enableRateLimiting) return next();

    const identifier = req.apiKeyMetadata?.id || req.ip;
    const limitInfo = memoryLimiter.isRateLimited(
      identifier,
      windowMs || authConfig.defaultRateLimitWindowMs,
      maxRequests || req.apiKeyMetadata?.rateLimit || authConfig.defaultRateLimitMax
    );

    res.setHeader('X-RateLimit-Limit', limitInfo.limit);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, limitInfo.limit - limitInfo.current));
    res.setHeader('X-RateLimit-Reset', limitInfo.resetMs);

    if (limitInfo.limited) {
      metrics.increment('rateLimitExceeded');
      AuditLogger.logFailure(req, 'Rate limit exceeded', 'rate_limit_exceeded', {
        identifier,
        limit: limitInfo.limit,
      });

      return res.status(429).json({
        error: 'Too Many Requests',
        message: `API Rate limit exceeded. Try again in ${limitInfo.resetMs} seconds.`,
      });
    }

    next();
  };
};

// ============================================================================
// FILE: src/middleware/hmacAuth.js
// Description: HMAC Signature verification middleware for integrity protection
// ============================================================================

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

// ============================================================================
// FILE: src/middleware/rbac.js
// Description: Role & Scope Verification Middleware
// ============================================================================

export const requireScopes = (...requiredScopes) => {
  return (req, res, next) => {
    const keyScopes = req.apiKeyMetadata?.scopes || [];

    // Wildcard access allowed
    if (keyScopes.includes('*')) {
      return next();
    }

    const hasPermission = requiredScopes.every((scope) => keyScopes.includes(scope));

    if (!hasPermission) {
      metrics.increment('scopeUnauthorized');
      AuditLogger.logFailure(req, `Insufficient scopes. Required: ${requiredScopes.join(', ')}`, 'forbidden_scope');

      return res.status(403).json({
        error: 'Forbidden',
        message: `Your API key lacks the required scopes: [${requiredScopes.join(', ')}]`,
      });
    }

    next();
  };
};

// ============================================================================
// FILE: src/middleware/ipWhitelist.js
// Description: IP Restriction Filter
// ============================================================================

export const enforceIpWhitelist = (req, res, next) => {
  const allowedIps = req.apiKeyMetadata?.ipWhitelist;

  if (!allowedIps || allowedIps.length === 0) {
    return next();
  }

  const clientIp = req.ip || req.socket.remoteAddress;

  if (!allowedIps.includes(clientIp)) {
    AuditLogger.logFailure(req, `IP ${clientIp} not in whitelist`, 'ip_not_whitelisted');
    return res.status(403).json({ error: 'Forbidden: IP Address client restriction' });
  }

  next();
};

// ============================================================================
// FILE: src/middleware/apiKeyAuth.js
// Description: Refactored Core API Key Authentication Middleware
// ============================================================================

/**
 * Enhanced Middleware for backend-to-backend API Key Authentication.
 * Supports timing-safe checking, environment fallback, repository metadata,
 * IP filtering, and zero-downtime key rotation.
 */
export const requireApiKey = (req, res, next) => {
  // 1. Extract API Key from Headers (or Query if explicitly enabled)
  let apiKey = req.headers[authConfig.keyHeaderName];

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

// ============================================================================
// FILE: src/services/keyRotationService.js
// Description: Zero-Downtime Key Rotation Automation Engine
// ============================================================================

export class KeyRotationService {
  constructor() {
    this.rotationListeners = [];
  }

  onRotation(fn) {
    this.rotationListeners.push(fn);
  }

  /**
   * Gracefully adds a new key while retaining old keys during transition.
   */
  rotateKey(oldKeyId, newKeyConfig) {
    const newKey = generateSecureApiKey();
    const registered = keyRepo.registerKey({
      ...newKeyConfig,
      key: newKey,
    });

    logger.info({ oldKeyId, newKeyId: registered.id }, 'Initiated API key rotation');

    // Notify external services (e.g. AWS Secrets Manager, Vault, Slack)
    this.rotationListeners.forEach((listener) => {
      try {
        listener({ event: 'rotated', oldKeyId, newKeyRecord: registered, rawNewKey: newKey });
      } catch (err) {
        logger.error({ err }, 'Error in key rotation listener callback');
      }
    });

    return { rawNewKey: newKey, record: registered };
  }

  /**
   * Schedule automatic key revocation after grace period (e.g., 24 hours)
   */
  scheduleRevocation(keyId, delayMs = 86400000) {
    logger.info({ keyId, delayMs }, `Key revocation scheduled in ${delayMs / 1000}s`);
    setTimeout(() => {
      const success = keyRepo.revoke(keyId);
      if (success) {
        logger.info({ keyId }, 'Scheduled key revocation completed');
      }
    }, delayMs);
  }
}

export const keyRotationService = new KeyRotationService();

// ============================================================================
// FILE: src/routes/adminKeysApi.js
// Description: Express Router for managing API keys dynamically
// ============================================================================

import express from 'express';

export const createAdminApiRouter = () => {
  const router = express.Router();

  // Create a new key dynamically
  router.post('/keys', (req, res) => {
    const { name, scopes, rateLimit, expiresInDays, ipWhitelist } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Bad Request: "name" is required' });
    }

    const rawKey = generateSecureApiKey();
    const expiresAt = expiresInDays ? Date.now() + expiresInDays * 86400000 : null;

    const record = keyRepo.registerKey({
      key: rawKey,
      name,
      scopes: scopes || ['*'],
      rateLimit: rateLimit || 100,
      expiresAt,
      ipWhitelist: ipWhitelist || [],
    });

    res.status(201).json({
      message: "API Key created successfully. Store raw key safely - it won't be shown again.",
      apiKey: rawKey,
      metadata: record,
    });
  });

  // Revoke an API key
  router.delete('/keys/:id', (req, res) => {
    const { id } = req.params;
    const success = keyRepo.revoke(id);

    if (!success) {
      return res.status(404).json({ error: 'Key ID not found' });
    }

    res.json({ message: `API Key ${id} has been revoked successfully` });
  });

  // Get metrics
  router.get('/metrics', (req, res) => {
    res.json(metrics.getMetrics());
  });

  return router;
};

// ============================================================================
// FILE: src/app.js
// Description: Complete Express Application Integration Example
// ============================================================================

export function createServer() {
  const app = express();

  app.use(express.json());

  // Health check endpoint (Unauthenticated)
  app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  // Admin Endpoints (Protected by Master Key or OAuth in real deployment)
  app.use('/admin', createAdminApiRouter());

  // Secured API Route Group with Auth + Rate Limiting + Scope Checks
  app.use(
    '/api/v1',
    requireApiKey,
    enforceIpWhitelist,
    applyRateLimit(60000, 100), // 100 reqs/min
    requireHmacSignature
  );

  // Example Scoped Endpoint
  app.get('/api/v1/analytics', requireScopes('read:analytics'), (req, res) => {
    res.json({
      data: [
        { metric: 'page_views', value: 10420 },
        { metric: 'conversion_rate', value: '3.2%' },
      ],
      client: req.apiKeyMetadata.name,
    });
  });

  // Example Write Endpoint
  app.post('/api/v1/users', requireScopes('write:users'), (req, res) => {
    res.status(201).json({
      message: 'User created successfully',
      context: req.apiKeyMetadata.id,
    });
  });

  return app;
}

// ============================================================================
// FILE: tests/authMiddleware.test.js
// Description: Unit & Integration tests for Authentication Stack
// ============================================================================

/* 
Example Test Suite using Jest / Supertest:

import request from 'supertest';
import { createServer } from '../src/app.js';
import { authConfig } from '../src/config/authConfig.js';

describe('API Key Auth Middleware Suite', () => {
  let app;

  beforeAll(() => {
    process.env.VALID_API_KEYS = 'test_key_123,test_key_456';
    authConfig.reload();
    app = createServer();
  });

  test('401 when API key header is missing', async () => {
    const res = await request(app).get('/api/v1/analytics');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Missing API Key');
  });

  test('401 when invalid API key is supplied', async () => {
    const res = await request(app)
      .get('/api/v1/analytics')
      .set('x-api-key', 'wrong_key_999');
    expect(res.status).toBe(401);
    expect(res.body.error).toContain('Invalid API Key');
  });

  test('200 when valid API key is supplied', async () => {
    const res = await request(app)
      .get('/api/v1/analytics')
      .set('x-api-key', 'test_key_123');
    expect(res.status).toBe(200);
    expect(res.body.client).toBeDefined();
  });
});
*/