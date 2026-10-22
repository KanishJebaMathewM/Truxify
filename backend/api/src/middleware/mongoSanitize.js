import logger from './logger.js';

const PROHIBITED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function isProhibitedKey(key) {
  return key.startsWith('$') || key.includes('$') || key.includes('.') || PROHIBITED_KEYS.has(key);
}

/**
 * Checks recursively if an object/array contains a MongoDB operator, a dotted
 * key, or a prototype-pollution key.
 */
export function hasNoSqlInjection(val) {
  if (!val || typeof val !== 'object') return false;

  if (Array.isArray(val)) {
    return val.some((item) => hasNoSqlInjection(item));
  }

  for (const key of Object.keys(val)) {
    if (isProhibitedKey(key)) {
      return true;
    }
    if (hasNoSqlInjection(val[key])) {
      return true;
    }
  }

  return false;
}

/**
 * Recursively strips MongoDB operators and prototype-pollution keys.
 */
export function sanitizeNoSqlObject(val) {
  if (!val || typeof val !== 'object') return val;

  if (Array.isArray(val)) {
    return val.map((item) => sanitizeNoSqlObject(item));
  }

  const cleanObj = {};
  for (const key of Object.keys(val)) {
    if (isProhibitedKey(key)) {
      continue; // Strip prohibited key
    }
    cleanObj[key] = sanitizeNoSqlObject(val[key]);
  }
  return cleanObj;
}

/**
 * Express middleware to prevent NoSQL Injection in req.body, req.query, and req.params.
 * Rejects requests containing MongoDB operators ($gt, $ne, $where, etc.) with a 400 Bad Request error.
 */
export default function mongoSanitize(options = {}) {
  const { dryRun = false } = options;

  return (req, res, next) => {
    try {
      if (hasNoSqlInjection(req.body) || hasNoSqlInjection(req.query) || hasNoSqlInjection(req.params)) {
        logger.warn(
          {
            requestId: req.requestId,
            ip: req.ip,
            path: req.originalUrl,
            method: req.method,
          },
          'NoSQL injection pattern detected in request'
        );

        if (!dryRun) {
          return res.status(400).json({
            error: 'Invalid input: NoSQL injection attempt detected',
          });
        }
      }

      if (req.body && typeof req.body === 'object') {
        req.body = sanitizeNoSqlObject(req.body);
      }
      if (req.query && typeof req.query === 'object') {
        const cleanQuery = sanitizeNoSqlObject(req.query);
        Object.defineProperty(req, 'query', {
          value: cleanQuery,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      }
      if (req.params && typeof req.params === 'object') {
        req.params = sanitizeNoSqlObject(req.params);
      }

      return next();
    } catch (err) {
      logger.error({ err }, 'Error running mongoSanitize middleware');
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  };
}
