import logger from './logger.js';

const RECOMMENDED_ATTRIBUTES = ['HttpOnly', 'SameSite', 'Path', 'Secure'];

export default function cookieSecurityValidator(req, res, next) {
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
    // Attribute names are case-insensitive per RFC 6265 (e.g. `httponly`
    // is equivalent to `HttpOnly`), so match on the lowercased cookie.
    const lowerCookie = cookieValue.toLowerCase();
    const missingAttributes = RECOMMENDED_ATTRIBUTES.filter(
      (attribute) => !lowerCookie.includes(attribute.toLowerCase())
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

export function isSecureCookieConfig(cookieHeader) {
  if (!cookieHeader || typeof cookieHeader !== 'string') return false;
  const lower = cookieHeader.toLowerCase();
  return RECOMMENDED_ATTRIBUTES.every((attr) => lower.includes(attr.toLowerCase()));
}

