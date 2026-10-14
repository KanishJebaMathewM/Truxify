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
  // header -> last assigned value: identical re-writes are silent no-ops
  // (never forwarded downstream), conflicting re-writes warn once per header.
  const lastValues = new Map();
  const warned = new Set();
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
        if (warned.has(header)) return;
        warned.add(header);
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
      } else if (lastValues.has(header)) {
        if (lastValues.get(header) === value) {
          // Identical re-write — nothing changes downstream; don't forward.
          return res;
        }
        warnDuplicate();
        lastValues.set(header, value);
      } else {
        lastValues.set(header, value);
      }
    }

    return originalSetHeader(name, value);
  };

  next();
}