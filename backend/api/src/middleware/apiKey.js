import logger from './logger.js';
import * as Sentry from '@sentry/node';

/**
 * Middleware for backend-to-backend API Key Authentication with Rotation Support.
 * 
 * Supports providing multiple valid API keys in the VALID_API_KEYS environment
 * variable (comma-separated) to allow for zero-downtime key rotation.
 */
export const requireApiKey = (req, res, next) => {
  // Only the x-api-key header authenticates. Accepting api_key from the query
  // string leaks the shared credential into access logs, CDN/proxy logs,
  // browser history and Referer headers, so it is intentionally ignored.
  const rawKey = req.headers['x-api-key'];
  const apiKey = Array.isArray(rawKey) ? rawKey[0] : rawKey;

  const validKeysStr = process.env.VALID_API_KEYS || '';
  const validKeys = validKeysStr.split(',').map(k => k.trim()).filter(Boolean);

  if (validKeys.length === 0) {
    // req.path excludes the query string so attempted ?api_key=... values are
    // never written to logs.
    logger.error({ ip: req.ip, path: req.path }, 'API key auth unavailable: VALID_API_KEYS is not configured');
    return res.status(503).json({
      error: 'Service Unavailable: API key authentication is not configured.',
    });
  }

  if (!apiKey || !validKeys.includes(apiKey)) {
    logger.warn({ ip: req.ip, path: req.path }, 'Invalid or missing API Key');

    Sentry.withScope((scope) => {
      scope.setTag('event_type', 'invalid_api_key');
      scope.setExtra('ip', req.ip);
      scope.setExtra('path', req.path);
      Sentry.captureMessage(`Invalid API Key attempt from IP: ${req.ip}`, 'warning');
    });

    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  next();
};
