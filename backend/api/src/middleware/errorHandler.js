import logger from './logger.js';
import { AppError } from '../utils/errors.js';

export function errorHandler(err, req, res, next) {
  if (err && err.name === 'MulterError') {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({
      success: false,
      error: `File upload error: ${err.message}`,
      code: err.code
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
