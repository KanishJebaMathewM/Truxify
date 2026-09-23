// Dynamic API key configuration store with validation and rotation support.
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