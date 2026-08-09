import logger from './logger.js';

const DEFAULT_LIMIT = 8192; // 8 KB

export default function headerSizeMonitor(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return next();
  }

  const rawLimit = process.env.HEADER_SIZE_LIMIT;
  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  let totalSize = 0;

  for (const [name, value] of Object.entries(req.headers)) {
    totalSize += Buffer.byteLength(name);

    if (Array.isArray(value)) {
      for (const item of value) {
        totalSize += Buffer.byteLength(String(item));
      }
    } else if (value !== undefined) {
      totalSize += Buffer.byteLength(String(value));
    }
  }

  if (totalSize > limit) {
    logger.warn(
      {
        method: req.method,
        path: req.originalUrl,
        headerSize: totalSize,
        limit,
      },
      'Request headers exceed configured size threshold'
    );
  }

  next();
}
