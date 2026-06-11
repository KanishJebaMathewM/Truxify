function formatValidationIssues(error) {
  return error.issues.map(issue => ({
    field: issue.path.length > 0 ? issue.path.join('.') : 'body',
    message: issue.message,
  }));
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
    const result = schema.safeParse(req.query);

    if (!result.success) {
      return res.status(400).json({
        error: 'Validation failed',
        details: formatValidationIssues(result.error),
      });
    }

    req.query = result.data;
    return next();
  };
}
