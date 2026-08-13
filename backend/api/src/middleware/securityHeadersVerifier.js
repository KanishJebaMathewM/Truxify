import logger from './logger.js';

const REQUIRED_HEADERS = [
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-resource-policy',
];

export default function securityHeadersVerifier(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  res.on('finish', () => {
    const missingHeaders = REQUIRED_HEADERS.filter(
      header => !res.getHeader(header)
    );

    if (missingHeaders.length > 0) {
      logger.warn(
        {
          method: req.method,
          path: req.originalUrl,
          missingHeaders,
        },
        'Missing expected security headers'
      );
    }
  });

  next();
}

// === Spec 24: ===
// === Spec 24: prevent duplicate header ===
export function safeSetHeader(res, name, value) {
  if (!res || !res.setHeader || !res.getHeader) return false;
  if (res.getHeader(name)) return false;
  res.setHeader(name, value);
  return true;
}

