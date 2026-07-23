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

  // Control referrer information
  if (!res.getHeader('Referrer-Policy')) {
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  }

  // Restrict browser features
  if (!res.getHeader('Permissions-Policy')) {
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=()'
    );
  }

  // Prevent cross-origin resource abuse
  if (!res.getHeader('Cross-Origin-Resource-Policy')) {
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  }

  // Do NOT override an existing CSP
  next();
}