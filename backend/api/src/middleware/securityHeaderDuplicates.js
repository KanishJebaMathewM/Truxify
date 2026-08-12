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

  const seen = new Map();
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    const header = String(name).toLowerCase();

    if (MONITORED_HEADERS.has(header)) {
      // A single assignment may carry an array of values (e.g. multiple
      // Set-Cookie headers). Collapse the value to a signature so one
      // array-valued assignment is treated as a single logical set, and
      // idempotent re-sets of the same value are not flagged. Only a
      // genuinely different value on the same header warns.
      const signature = JSON.stringify(value);
      const previous = seen.get(header);

      if (previous !== undefined && previous !== signature) {
        logger.warn(
          {
            method: req.method,
            path: req.originalUrl,
            header,
          },
          'Duplicate security header assignment detected'
        );
      }

      seen.set(header, signature);
    }

    return originalSetHeader(name, value);
  };

  next();
}