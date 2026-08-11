/**
 * Security Headers Middleware
 *
 * Adds common HTTP security headers while preserving any
 * existing Content-Security-Policy configuration.
 */

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
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
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