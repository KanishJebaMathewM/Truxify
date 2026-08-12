import logger from './logger.js';

export default function cacheControlVerifier(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  res.on('finish', () => {
    if (!req.user) {
      return;
    }

    const cacheControl = res.getHeader('Cache-Control');
    const pragma = res.getHeader('Pragma');
    const expires = res.getHeader('Expires');

    const warnings = [];

    if (!cacheControl) {
      warnings.push('Cache-Control');
    } else {
      const value = String(cacheControl).toLowerCase();

      if (
        !value.includes('no-store') &&
        !value.includes('no-cache') &&
        !value.includes('private')
      ) {
        warnings.push('Cache-Control policy');
      }
    }

    if (!pragma) {
      warnings.push('Pragma');
    }

    if (!expires) {
      warnings.push('Expires');
    }

    if (warnings.length > 0) {
      logger.warn(
        {
          method: req.method,
          path: req.originalUrl,
          missingHeaders: warnings,
        },
        'Authenticated response may be cacheable'
      );
    }
  });

  next();
}