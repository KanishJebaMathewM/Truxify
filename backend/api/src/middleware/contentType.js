export function contentTypeMiddleware(req, res, next) {
  // Only check mutating requests that should have a body
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.headers['content-type'] || '';
    
    // We expect either application/json or multipart/form-data
    if (!contentType.includes('application/json') && !contentType.includes('multipart/form-data')) {
      return res.status(415).json({
        error: 'Unsupported Media Type: Content-Type must be application/json or multipart/form-data'
      });
    }
  }
  next();
}
