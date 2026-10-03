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
      error: {
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Payload too large',
        details: {}
      }
    });
  }

  if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
    logger.warn(
      { requestId: req.requestId, ip: req.ip, method: req.method, path: req.originalUrl },
      'Malformed JSON payload received'
    );
    return res.status(400).json({
      success: false,
      error: {
        code: 'MALFORMED_JSON',
        message: 'Malformed JSON payload',
        details: {}
      }
    });
  }

  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error: {
        code: err.code === 'LIMIT_FILE_SIZE' ? 'PAYLOAD_TOO_LARGE' : 'UPLOAD_ERROR',
        message: `File upload error: ${err.message}`,
        details: { multerCode: err.code }
      }
    });
  }

  // Handle Zod validation errors
  if (err && err.name === 'ZodError') {
    logger.warn({ requestId: req.requestId, errors: err.issues }, 'Zod validation failed');
    return res.status(400).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        details: err.issues.reduce((acc, e) => {
          acc[e.path.join('.')] = e.message;
          return acc;
        }, {})
      }
    });
  }

  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details || {}
      }
    });
  }

  logger.error({ requestId: req.requestId, err }, 'Unhandled express exception');
  
  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'Critical Internal Server Error.',
      details: {}
    }
  });
}
