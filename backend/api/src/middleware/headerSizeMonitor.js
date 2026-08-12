import logger from './logger.js';

const DEFAULT_LIMIT = 8192; // 8 KB

export default function headerSizeMonitor(req, res, next) {
  const rawLimit = process.env.HEADER_SIZE_LIMIT;
  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  let totalSize = 0;

  for (const [name, value] of Object.entries(req.headers)) {
    if (name === undefined || name === null) continue;
    totalSize += Buffer.byteLength(String(name));

    if (Array.isArray(value)) {
      for (const item of value) {
        if (item === undefined || item === null) continue;
        totalSize += Buffer.byteLength(String(item));
        // Early exit: no need to keep measuring once the limit is crossed.
        if (totalSize > limit) break;
      }
    } else if (value !== undefined && value !== null) {
      totalSize += Buffer.byteLength(String(value));
    }

    if (totalSize > limit) break;
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
