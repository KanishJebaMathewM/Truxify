import logger from './logger.js';
import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  if (err?.type === 'entity.too.large') {
    logger.warn(
      { requestId: req.requestId, ip: req.ip, method: req.method, path: req.originalUrl },
      'Request payload exceeded configured limit'
    );
    return res.status(413).json({
      success: false,
      error: 'Payload too large'
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn(
      { requestId: req.requestId, ip: req.ip, method: req.method, path: req.originalUrl },
      'Malformed JSON payload received'
    );
    return res.status(400).json({
      success: false,
      error: 'Malformed JSON payload'
    });
  }

  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error: `File upload error: ${err.message}`,
      code: err.code
    });
  }

  // Handle Zod validation errors
  if (err && err.name === 'ZodError') {
    logger.warn({ requestId: req.requestId, errors: err.errors }, 'Zod validation failed');
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: err.errors.map(e => ({ field: e.path.join('.'), message: e.message })),
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: err.message
    });
  }

  logger.error({ requestId: req.requestId, err }, 'Unhandled express exception');
  
  res.status(500).json({
    success: false,
    error: 'Critical Internal Server Error.'
  });
}
