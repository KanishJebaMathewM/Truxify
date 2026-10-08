import logger from './logger.js';

/**
 * Middleware to monitor and log authentication and authorization failures.
 */
export function authFailureMonitor(req, res, next) {
  res.on('finish', () => {
    if (res.statusCode === 401 || res.statusCode === 403) {
      logger.warn(
        {
          path: req.path,
          method: req.method,
          statusCode: res.statusCode,
          ip: req.ip,
          requestId: req.id,
        },
        '[auth-failure-monitor] Authentication or authorization failure detected'
      );
    }
  });
  next();
}

export default authFailureMonitor;
