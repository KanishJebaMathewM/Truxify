/**
 * Strict pagination middleware to prevent memory exhaustion from large 'limit' values.
 * Parses and caps limit and offset parameters.
 */
export function validatePagination(options = {}) {
  const maxLimit = options.maxLimit || 100;
  const defaultLimit = options.defaultLimit || 10;
  const defaultOffset = options.defaultOffset || 0;

  return (req, res, next) => {
    // 1. Parse limit
    let limit = defaultLimit;
    if (req.query.limit) {
      const parsed = parseInt(req.query.limit, 10);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, maxLimit);
      } else {
        return res.status(400).json({ error: 'Invalid limit parameter' });
      }
    }

    // 2. Parse offset (or page)
    let offset = defaultOffset;
    if (req.query.offset) {
      const parsed = parseInt(req.query.offset, 10);
      if (Number.isFinite(parsed) && parsed >= 0) {
        offset = parsed;
      } else {
        return res.status(400).json({ error: 'Invalid offset parameter' });
      }
    } else if (req.query.page) {
       const parsedPage = parseInt(req.query.page, 10);
       if (Number.isFinite(parsedPage) && parsedPage > 0) {
          offset = (parsedPage - 1) * limit;
       } else {
          return res.status(400).json({ error: 'Invalid page parameter' });
       }
    }

    // Reassign normalized values back to query so downstream controllers see capped values safely
    req.query.limit = limit;
    req.query.offset = offset;
    
    // Also provide a structured object
    req.pagination = { limit, offset };
    
    next();
  };
}
