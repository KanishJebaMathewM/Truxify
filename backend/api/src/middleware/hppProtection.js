import logger from './logger.js';

export default function hppProtection(req, res, next) {
  const duplicateParams = [];

  for (const [key, value] of Object.entries(req.query)) {
    if (Array.isArray(value)) {
      duplicateParams.push(key);

      // Preserve backward compatibility by consistently selecting
      // the first value. A nested array (e.g. `?a=1&a=2&a=3` parsed as
      // `[['1','2'],'3']` by some middleware) is flattened so the query
      // value can never remain an array after this middleware runs.
      let first = value[0];
      while (Array.isArray(first)) {
        first = first[0];
      }
      req.query[key] = first;
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