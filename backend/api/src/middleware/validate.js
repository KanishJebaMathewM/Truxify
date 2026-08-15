import logger from './logger.js';

export function formatValidationIssues(error) {
  return error.issues.map((issue) => ({
    field: issue.path.length > 0 ? issue.path.join(".") : "body",
    message: issue.message,
  }));
}

export function validateArray(schema) {
  return (req, res, next) => {
    if (!Array.isArray(req.body)) {
      return res
        .status(400)
        .json({ error: "Expected an array in request body" });
    }
    const results = req.body.map((item) => schema.safeParse(item));
    const errors = results
      .filter((r) => !r.success)
      .map((r) => formatValidationIssues(r.error));
    if (errors.length > 0) {
      return res
        .status(400)
        .json({ error: "Array validation failed", details: errors.flat() });
    }
    req.body = results.map((r) => r.data);
    return next();
  };
}

export function validateBody(schema) {
  return (req, res, next) => {
    // Guard: req.body must be present before schema validation.
    if (req.body == null) {
      return res.status(400).json({
        error: "Request body is required",
      });
    }

    const result = schema.safeParse(req.body);

    if (!result.success) {
      logger.warn(
        { event: 'VALIDATION_ERROR', type: 'body', requestId: req.requestId || req.id, details: formatValidationIssues(result.error) },
        'Body validation failed',
      );
      return res.status(400).json({
        error: "Validation failed",
        details: formatValidationIssues(result.error),
      });
    }

    req.body = result.data;
    return next();
  };
}

export function validateParams(schema) {
  return (req, res, next) => {
    // Guard: req.params must be present before schema validation.
    if (req.params == null) {
      return res.status(400).json({
        error: "Request params are required",
      });
    }

    const result = schema.safeParse(req.params);

    if (!result.success) {
      logger.warn(
        { event: 'VALIDATION_ERROR', type: 'params', requestId: req.requestId || req.id, details: formatValidationIssues(result.error) },
        'Params validation failed',
      );
      return res.status(400).json({
        error: "Validation failed",
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
        logger.warn(
          { event: 'VALIDATION_ERROR', type: 'query', requestId: req.requestId || req.id, details: formatValidationIssues(result.error) },
          'Query validation failed',
        );
        return res.status(400).json({
          error: "Validation failed",
          details: formatValidationIssues(result.error),
        });
      }

      // req.query may be a read-only getter in some Node.js / express versions;
      // define it as a configurable writable property before assigning.
      Object.defineProperty(req, "query", {
        value: result.data,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      return next();
    } catch (err) {
      // A malformed query (e.g. a huge nested value that overflows the schema
      // parser) is a client error, not a server fault: report it as a 400.
      logger.warn(
        {
          event: 'VALIDATION_ERROR',
          type: 'query',
          requestId: req.requestId || req.id,
          error: err.message,
        },
        'Query validation threw',
      );
      return res.status(400).json({
        error: "Validation failed",
        details: [{ field: "query", message: err.message }],
      });
    }
  };
}
