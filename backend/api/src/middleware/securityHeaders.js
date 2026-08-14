/**
 * Security Headers Middleware
 *
 * Adds common HTTP security headers while preserving any
 * existing Content-Security-Policy configuration.
 */

const DEFAULT_HSTS_MAX_AGE = 31536000; // 1 year, the previously hardcoded value
const MIN_HSTS_MAX_AGE = 60; // 1 minute — never allow a weaker bound
const MAX_HSTS_MAX_AGE = 63072000; // 2 years

// Resolve the Strict-Transport-Security max-age from SECURE_HSTS_MAX_AGE with
// a bounded fallback so deployments can tune it without accidentally weakening
// the value to 0, a negative number, or an unbounded one.
function resolveHstsMaxAge() {
  const raw = Number(process.env.SECURE_HSTS_MAX_AGE);
  if (Number.isFinite(raw) && raw > MIN_HSTS_MAX_AGE && raw <= MAX_HSTS_MAX_AGE) {
    return Math.floor(raw);
  }
  return DEFAULT_HSTS_MAX_AGE;
}

export default function securityHeaders(req, res, next) {
  // Prevent MIME-type sniffing
  if (!res.getHeader('X-Content-Type-Options')) {
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }

  // Prevent clickjacking attacks
  if (!res.getHeader('X-Frame-Options')) {
    res.setHeader('X-Frame-Options', 'DENY');
  }

  // Enable XSS filter in browsers
  if (!res.getHeader('X-XSS-Protection')) {
    res.setHeader('X-XSS-Protection', '1; mode=block');
  }

  // Enforce HTTPS for sensitive headers
  if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
    if (!res.getHeader('Strict-Transport-Security')) {
      const hstsPreload =
        process.env.SECURE_HSTS_PRELOAD === 'true' || process.env.SECURE_HSTS_PRELOAD === '1';
      res.setHeader(
        'Strict-Transport-Security',
        `max-age=${resolveHstsMaxAge()}; includeSubDomains${hstsPreload ? '; preload' : ''}`
      );
    }
  }

  // Control referrer information
  if (!res.getHeader('Referrer-Policy')) {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  // Restrict browser features
  if (!res.getHeader('Permissions-Policy')) {
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(self), camera=(self), microphone=(self)'
    );
  }

  // Prevent cross-origin resource abuse
  if (!res.getHeader('Cross-Origin-Resource-Policy')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }

  // Prevent cross-origin embedding
  if (!res.getHeader('X-Content-Security-Policy')) {
    res.setHeader('X-Content-Security-Policy', "default-src 'self'");
  }

  // Do NOT override an existing CSP
  next();
}

// === Spec 11: ===
// === Spec 11: prevent HSTS header duplication ===
export function setHstsHeader(res) {
  if (!res.getHeader || res.getHeader('Strict-Transport-Security')) return false;
  const preload = process.env.SECURE_HSTS_PRELOAD;
  const includePreload = !preload || preload === 'true' || preload === '1';
  const header = includePreload
    ? 'max-age=63072000; includeSubDomains; preload'
    : 'max-age=63072000; includeSubDomains';
  res.setHeader('Strict-Transport-Security', header);
  return true;
}

