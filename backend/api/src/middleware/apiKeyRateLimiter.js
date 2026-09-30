import { authConfig } from '../config/authConfig.js';
import { metrics } from '../services/metricsService.js';
import { AuditLogger } from '../services/auditLogger.js';

// In-memory sliding window rate limiter per API key / IP.
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