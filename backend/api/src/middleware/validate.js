function formatValidationIssues(error) {
  return error.issues.map(issue => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
}

export function validateArray(schema) {
  return (req, res, next) => {
    if (!Array.isArray(req.body)) {
      return res.status(400).json({ error: 'Expected an array in request body' });
    }
    const results = req.body.map(item => schema.safeParse(item));
    const errors = results.filter(r => !r.success).map(r => formatValidationIssues(r.error));
    if (errors.length > 0) {
      return res.status(400).json({ error: 'Array validation failed', details: errors.flat() });
    }
    req.body = results.map(r => r.data);
    return next();
  };
}

export function validateBody(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationIssues(result.error),
      });
    }

    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.params);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationIssues(result.error),
      });
    }

    req.params = result.data;
    return next();
  };
}

export function validateQuery(schema) {
  return (req, res, next) => {
    try {
      const result = schema.safeParse(req.query);

      if (!result.success) {
        return res.status(400).json({
          error: 'Validation failed',
          details: formatValidationIssues(result.error),
        });
      }

      // req.query may be a read-only getter in some Node.js / express versions;
      // define it as a configurable writable property before assigning.
      Object.defineProperty(req, 'query', {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return next();
    } catch (err) {
      return res.status(500).json({
        error: 'Internal query validation error',
        details: err.message,
      });
    }
  };
}
