import logger from './logger.js';

export default function hppProtection(req, res, next) {
  const duplicateParams = [];

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      duplicateParams.push(key);

      // Preserve backward compatibility by consistently selecting
      // the first value.
      req.query[key] = value[0];
    }
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