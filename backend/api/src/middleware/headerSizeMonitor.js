import logger from './logger.js';

const DEFAULT_LIMIT = 8192; // 8 KB

export default function headerSizeMonitor(req, res, next) {
  const rawLimit = process.env.HEADER_SIZE_LIMIT;
  const parsedLimit = Number(rawLimit);
  const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : DEFAULT_LIMIT;

  // Guard: req.headers must be defined before iterating over it.
  if (req.headers == null) {
    return next();
  }

  // Measure the bytes on the wire. Counting only names and values omits the
  // ': ', CRLF and request-line overhead, so a request can be several hundred
  // bytes over the configured threshold and still pass. Node preserves the
  // original pairs in rawHeaders; fall back to the parsed map only when it is
  // unavailable (for example in unit tests).
  let rawTotal = 0;
  if (Array.isArray(req.rawHeaders)) {
    for (let i = 0; i < req.rawHeaders.length; i += 2) {
      rawTotal += Buffer.byteLength(String(req.rawHeaders[i] ?? ''));
      rawTotal += Buffer.byteLength(String(req.rawHeaders[i + 1] ?? ''));
      rawTotal += 4; // ': ' + CRLF
    }
    rawTotal += 2; // final CRLF
  }

  // Middleware and tests can add values to req.headers after Node has built
  // rawHeaders. Measure that view as well and use the larger result.
  let parsedTotal = 0;
  for (const [name, value] of Object.entries(req.headers)) {
    parsedTotal += Buffer.byteLength(name) + 4;
    if (Array.isArray(value)) {
      for (const item of value) {
        parsedTotal += Buffer.byteLength(String(item));
      }
    } else if (value !== undefined) {
      parsedTotal += Buffer.byteLength(String(value));
    }
  }
  let totalSize = Math.max(rawTotal, parsedTotal);

  if (totalSize > limit) {
    logger.warn(
      {
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
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
