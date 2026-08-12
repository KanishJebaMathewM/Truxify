import logger from './logger.js';
import * as Sentry from '@sentry/node';

/**
 * Middleware for backend-to-backend API Key Authentication with Rotation Support.
 * 
 * Supports providing multiple valid API keys in the VALID_API_KEYS environment
 * variable (comma-separated) to allow for zero-downtime key rotation.
 */
export const requireApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'] || req.query.api_key;
  
  const validKeysStr = process.env.VALID_API_KEYS || '';
  const validKeys = validKeysStr.split(',').map(k => k.trim()).filter(Boolean);

  if (validKeys.length === 0) {
    logger.error({ ip: req.ip, path: req.originalUrl }, 'API key auth unavailable: VALID_API_KEYS is not configured');
    return res.status(503).json({
      error: 'Service Unavailable: API key authentication is not configured.',
    });
  }

  if (!apiKey || !validKeys.includes(apiKey)) {
    logger.warn({ ip: req.ip, path: req.originalUrl }, 'Invalid or missing API Key');
    
    Sentry.withScope((scope) => {
      scope.setTag('event_type', 'invalid_api_key');
      scope.setExtra('ip', req.ip);
      scope.setExtra('path', req.originalUrl);
      Sentry.captureMessage(`Invalid API Key attempt from IP: ${req.ip}`, 'warning');
    });

    return res.status(401).json({ error: 'Unauthorized: Invalid API Key' });
  }

  next();
};
