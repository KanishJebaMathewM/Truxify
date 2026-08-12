import logger from './logger.js';

const DEFAULT_LIMIT = 8192; // 8 KB

export default function headerSizeMonitor(req, res, next) {
  const rawLimit = process.env.HEADER_SIZE_LIMIT;
  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  let totalSize = 0;

  for (const [name, value] of Object.entries(req.headers)) {
    totalSize += Buffer.byteLength(String(name));

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        // Stringify objects defensively; Buffer.byteLength on a non-string
        // throws, and header values can be nested in exotic proxies.
        totalSize += Buffer.byteLength(typeof item === 'string' ? item : JSON.stringify(item));
      }
    } else if (value !== undefined && value !== null) {
      totalSize += Buffer.byteLength(typeof value === 'string' ? value : String(value));
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
    return res.status(431).json({
      success: false,
      error: 'Request header fields too large',
    });
  }

  next();
}
