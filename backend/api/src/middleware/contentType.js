export function requireJsonContent(req, res, next) {
  // Only enforce on mutating requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    
    if (!contentType) {
      return res.status(415).json({ error: 'Unsupported Media Type. Content-Type header is missing.' });
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
    return res.status(415).json({ error: 'Unsupported Media Type. Expected application/json.' });
  }

  // Pass through for GET, DELETE, etc.
  next();
}
