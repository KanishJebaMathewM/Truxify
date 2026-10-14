import logger from '../middleware/logger.js';
import * as Sentry from '@sentry/node';
import { metrics } from './metricsService.js';

// Unified logging interface bridging Winston, Sentry, and internal metrics.
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