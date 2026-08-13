import logger from './logger.js';

const MONITORED_HEADERS = new Set([
  'content-security-policy',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
]);

export default function securityHeaderDuplicates(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  const seen = new Set();
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    const header = String(name).toLowerCase();

    if (MONITORED_HEADERS.has(header)) {
      if (seen.has(header)) {
        logger.warn(
          {
            method: req.method,
            path: req.originalUrl,
            header,
          },
          'Duplicate security header assignment detected'
        );
      }

      seen.add(header);
    }

    return originalSetHeader(name, value);
  };

  next();
}