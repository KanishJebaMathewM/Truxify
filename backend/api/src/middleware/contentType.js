export function requireJsonContent(req, res, next) {
  // Only enforce on mutating requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'];
    
    if (!contentType) {
      return res.status(415).json({ error: 'Unsupported Media Type. Content-Type header is missing.' });
    }

    // Allow application/json
    if (contentType.includes('application/json')) {
      return next();
    }

    // Allow multipart/form-data for specific routes (like document uploads)
    if (contentType.includes('multipart/form-data')) {
      return next();
    }

    // Reject all other content types
    return res.status(415).json({ error: 'Unsupported Media Type. Expected application/json.' });
  }

  // Pass through for GET, DELETE, etc.
  next();
}
