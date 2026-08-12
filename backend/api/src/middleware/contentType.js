export function requireJsonContent(req, res, next) {
  // Only enforce on mutating requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    let contentType = req.headers['content-type'];

    if (!contentType) {
      return res.status(415).json({
        error: 'Unsupported Media Type.',
        received: undefined,
        allowed: [
          'application/json',
          'application/x-www-form-urlencoded',
          'multipart/form-data',
        ],
      });
    }

    // A repeated `content-type` header arrives as an array. Only a single
    // media type is meaningful; reject the ambiguous multi-value form rather
    // than calling .split on an array (which would throw).
    if (Array.isArray(contentType)) {
      contentType = contentType[0];
      if (!contentType) {
        return res.status(415).json({
          error: 'Unsupported Media Type.',
          received: undefined,
          allowed: [
            'application/json',
            'application/x-www-form-urlencoded',
            'multipart/form-data',
          ],
        });
      }
    }

    // Compare the base media type exactly (ignoring parameters such as
    // charset). A substring match previously let malformed values like
    // `text/plain; application/json` or `application/jsonx` through.
    const mimeType = contentType.split(';')[0].trim().toLowerCase();

    // Allow the media types the API actually parses (express.json,
    // express.urlencoded, multer for uploads). Anything else is rejected.
    const allowed = [
      'application/json',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ];
    if (allowed.includes(mimeType)) {
      return next();
    }

    // Reject all other content types
    return res.status(415).json({
      error: 'Unsupported Media Type.',
      received: mimeType,
      allowed,
    });
  }

  // Pass through for GET, DELETE, etc.
  next();
}
