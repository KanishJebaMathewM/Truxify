import logger from './logger.js';

const MONITORED_HEADERS = new Set([
  'content-security-policy',
  'x-frame-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'set-cookie',
]);

export default function securityHeaderDuplicates(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  const seen = new Set();
  const seenCookies = new Set();
  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    // Guard against non-string header names (e.g. undefined from a proxy
    // layer) so no TypeError escapes the override; those are passed through.
    if (typeof name !== 'string') {
      return originalSetHeader(name, value);
    }
    const header = name.toLowerCase();

    if (MONITORED_HEADERS.has(header)) {
      const warnDuplicate = () => {
        logger.warn(
          {
            method: req.method,
            path: req.originalUrl,
            header,
          },
          'Duplicate security header assignment detected'
        );
      };

      if (header === 'set-cookie') {
        // Set-Cookie is legitimately set multiple times with distinct cookies,
        // so flag only the exact same cookie value being repeated.
        const cookies = Array.isArray(value) ? value : [value];
        for (const cookie of cookies) {
          const normalized = String(cookie);
          if (seenCookies.has(normalized)) {
            warnDuplicate();
          }
          seenCookies.add(normalized);
        }
      } else if (seen.has(header)) {
        warnDuplicate();
      } else {
        seen.add(header);
      }
    }

    return originalSetHeader(name, value);
  };

  next();
}