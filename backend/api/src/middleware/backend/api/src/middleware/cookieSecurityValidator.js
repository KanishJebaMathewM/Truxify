import logger from './logger.js';

export default function cookieSecurityValidator(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  res.on('finish', () => {
    const cookies = res.getHeader('Set-Cookie');

    if (!cookies) {
      return;
    }

    const cookieList = Array.isArray(cookies) ? cookies : [cookies];

    for (const cookie of cookieList) {
      const value = String(cookie);

      const missing = [];

      if (!/;\s*HttpOnly/i.test(value)) {
        missing.push('HttpOnly');
      }

      if (!/;\s*SameSite=/i.test(value)) {
        missing.push('SameSite');
      }

      if (!/;\s*Path=/i.test(value)) {
        missing.push('Path');
      }

      if (
        process.env.NODE_ENV === 'production' &&
        !/;\s*Secure/i.test(value)
      ) {
        missing.push('Secure');
      }

      if (missing.length > 0) {
        logger.warn(
          {
            method: req.method,
            path: req.originalUrl,
            missingAttributes: missing,
          },
          'Cookie missing recommended security attributes'
        );
      }
    }
  });

  next();
}