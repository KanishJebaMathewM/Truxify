import compression from 'compression';

/**
 * HTTP response compression policy.
 *
 * Truxify's clients are Flutter apps used by truck drivers on metered 3G/4G
 * connections along national highways. List endpoints return highly
 * repetitive JSON — the same object keys repeat on every array element —
 * which is the input gzip handles best. Every uncompressed byte is a data
 * cost borne by the user.
 *
 * Kept in its own module, alongside cors.js and securityHeaders.js, so the
 * policy is documented and testable rather than inlined in index.js.
 */

/**
 * Responses below this size are sent uncompressed. Below roughly one MTU the
 * CPU cost is not repaid, and very small payloads can grow once the gzip
 * header and trailer are added.
 */
export const COMPRESSION_THRESHOLD_BYTES = Number(
  process.env.COMPRESSION_THRESHOLD_BYTES || 1024
);

/**
 * zlib level, 1 (fastest) to 9 (smallest). 6 is zlib's default and sits at
 * the knee of the curve: levels above it cost noticeably more CPU for very
 * little additional saving on JSON.
 */
export const COMPRESSION_LEVEL = Number(process.env.COMPRESSION_LEVEL || 6);

/**
 * Content types that are already compressed. Re-compressing them burns CPU
 * and typically makes the payload marginally larger.
 */
const ALREADY_COMPRESSED = [
  'image/',
  'video/',
  'audio/',
  'application/zip',
  'application/gzip',
  'application/x-gzip',
  'application/pdf',
  'application/octet-stream',
];

/**
 * Decide whether a given response should be compressed.
 *
 * Exported for testing — the branches here are the ones most likely to be got
 * wrong, and they are invisible from the outside once wired into Express.
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
export function shouldCompress(req, res) {
  // Explicit per-request opt-out. Useful for debugging and for endpoints that
  // stream, where buffering for compression would defeat the point.
  if (req.headers['x-no-compression']) {
    return false;
  }

  const contentType = String(res.getHeader('Content-Type') || '').toLowerCase();
  if (ALREADY_COMPRESSED.some((prefix) => contentType.startsWith(prefix))) {
    return false;
  }

  // Server-Sent Events must not be buffered — compressing would delay or
  // swallow individual events.
  if (contentType.startsWith('text/event-stream')) {
    return false;
  }

  // Everything else defers to the library default, which honours the client's
  // Accept-Encoding and skips responses that are already encoded.
  return compression.filter(req, res);
}

/**
 * Configured compression middleware, ready to register in the Express chain.
 */
export const compressionMiddleware = compression({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  level: COMPRESSION_LEVEL,
  filter: shouldCompress,
});

export default compressionMiddleware;
