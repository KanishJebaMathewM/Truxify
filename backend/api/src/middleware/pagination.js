/**
 * Strict pagination middleware to prevent memory exhaustion from large 'limit' values.
 * Parses and caps limit and offset parameters.
 */
export function validatePagination(options = {}) {
  const maxLimit = options.maxLimit || 100;
  const maxOffset = options.maxOffset || 10000;
  const defaultLimit = options.defaultLimit || 10;
  const defaultOffset = options.defaultOffset || 0;
  const parseInteger = (value) => {
    if (!/^\d+$/.test(String(value))) {
      return null;
    }
    return Number.parseInt(value, 10);
  };

  return (req, res, next) => {
    // 1. Parse limit
    let limit = defaultLimit;
    if (req.query.limit) {
      const parsed = parseInteger(req.query.limit);
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.min(parsed, maxLimit);
      } else {
        return res.status(400).json({ error: 'Invalid limit parameter' });
      }
    }

    // 2. Parse offset (or page)
    let offset = defaultOffset;
    if (req.query.offset) {
      const parsed = parseInteger(req.query.offset);
      if (Number.isFinite(parsed) && parsed >= 0) {
        offset = Math.min(parsed, maxOffset);
      } else {
        return res.status(400).json({ error: 'Invalid offset parameter' });
      }
    } else if (req.query.page) {
       const parsedPage = parseInteger(req.query.page);
       if (Number.isFinite(parsedPage) && parsedPage > 0) {
          offset = Math.min((parsedPage - 1) * limit, maxOffset);
       } else {
          return res.status(400).json({ error: 'Invalid page parameter' });
       }
    }

    // Reassign normalized values back to query so downstream controllers see capped values safely
    req.query.limit = limit;
    req.query.offset = offset;
    
    // Also provide a structured object
    req.pagination = { limit, offset };

    // Intercept res.json to inject X-Total-Count header
    const originalJson = res.json;
    res.json = function (body) {
      if (body && typeof body === 'object') {
        const count = body.totalCount ?? body.count ?? body.total;
        if (count !== undefined) {
          res.setHeader('X-Total-Count', String(count));
          res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count');
        }
      }
      return originalJson.call(this, body);
    };
    
    next();
  };
}
