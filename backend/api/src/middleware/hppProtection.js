import logger from './logger.js';

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

function normalizeValue(value, path, duplicateParams) {
  if (Array.isArray(value)) {
    if (value.length > 1) duplicateParams.push(path);
    return value.length === 0 ? '' : normalizeValue(value[0], path, duplicateParams);
  }

  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (UNSAFE_KEYS.has(key)) {
        delete value[key];
        continue;
      }
      const childPath = path ? `${path}.${key}` : key;
      value[key] = normalizeValue(value[key], childPath, duplicateParams);
    }
  }

  return value;
}

export default function hppProtection(req, res, next) {
  const duplicateParams = [];

  if (req.query && typeof req.query === 'object') {
    normalizeValue(req.query, '', duplicateParams);
  }

  if (duplicateParams.length > 0) {
    logger.warn(
      {
        requestId: req.requestId,
        ip: req.ip,
        path: req.originalUrl,
        duplicateParams,
      },
      'Potential HTTP Parameter Pollution detected'
    );
  }

  next();
}