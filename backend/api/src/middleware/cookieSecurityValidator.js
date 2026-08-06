import logger from './logger.js';

const RECOMMENDED_ATTRIBUTES = ['HttpOnly', 'SameSite', 'Path'];

export default function cookieSecurityValidator(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  const originalSetHeader = res.setHeader.bind(res);

  res.setHeader = (name, value) => {
    if (String(name).toLowerCase() === 'set-cookie') {
      validateCookies(req, value);
    }
    return originalSetHeader(name, value);
  };

  next();
}

function validateCookies(req, value) {
  const cookies = Array.isArray(value) ? value : [value];

  for (const cookie of cookies) {
    const cookieValue = String(cookie);
    const missingAttributes = RECOMMENDED_ATTRIBUTES.filter(
      (attribute) => !cookieValue.includes(attribute)
    );

    if (missingAttributes.length === 0) continue;

    logger.warn(
      {
        method: req.method,
        path: req.originalUrl,
        missingAttributes,
      },
      'Cookie missing recommended security attributes'
    );
  }
}
