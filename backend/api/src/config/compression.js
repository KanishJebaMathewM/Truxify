
import compression from 'compression';

/**
 * HTTP response compression policy.
 *
 * Optimized for Flutter clients operating on metered mobile connections.
 * JSON responses benefit significantly from gzip because repeated object
 * keys and values compress efficiently.
 *
 * Register after security headers and before route handlers.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                              */
/* -------------------------------------------------------------------------- */

const DEFAULT_THRESHOLD = 1024;
const DEFAULT_LEVEL = 6;

/**
 * Parse a positive integer environment variable.
 *
 * Invalid, empty, fractional, or out-of-range values fall back to defaults.
 */
function readPositiveInteger(name, fallback, max = Number.MAX_SAFE_INTEGER) {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number(raw);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0 ||
    parsed > max
  ) {
    return fallback;
  }

  return parsed;
}

const parsedThreshold = readPositiveInteger(
  'COMPRESSION_THRESHOLD_BYTES',
  DEFAULT_THRESHOLD
);

const parsedLevel = readPositiveInteger(
  'COMPRESSION_LEVEL',
  DEFAULT_LEVEL,
  9
);

export const COMPRESSION_THRESHOLD_BYTES = parsedThreshold;
export const COMPRESSION_LEVEL = parsedLevel;

/**
 * Frozen configuration prevents accidental runtime mutation.
 */
export const compressionConfig = Object.freeze({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  level: COMPRESSION_LEVEL,
});

/* -------------------------------------------------------------------------- */
/* Content types                                                              */
/* -------------------------------------------------------------------------- */

/**
 * MIME types that are already compressed or generally unsuitable for gzip.
 *
 * Matching is performed against the normalized MIME type, excluding
 * parameters such as charset and boundary.
 */
const ALREADY_COMPRESSED_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/gzip',
  'application/x-gzip',
  'application/x-7z-compressed',
  'application/x-rar-compressed',
  'application/x-bzip2',
  'application/x-xz',
  'application/zstd',
  'application/pdf',
  'application/octet-stream',
  'application/wasm',
  'font/woff',
  'font/woff2',
  'application/font-woff',
  'application/vnd.rar',
]);

const ALREADY_COMPRESSED_PREFIXES = [
  'image/',
  'video/',
  'audio/',
];

/**
 * Normalize a Content-Type header.
 *
 * Example:
 *   application/json; charset=utf-8
 *   -> application/json
 */
function normalizeContentType(value) {
  if (!value) return '';

  return String(value)
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
}

/**
 * Determine whether a MIME type is already compressed.
 */
function isAlreadyCompressed(contentType) {
  if (!contentType) return false;

  if (ALREADY_COMPRESSED_TYPES.has(contentType)) {
    return true;
  }

  return ALREADY_COMPRESSED_PREFIXES.some((prefix) =>
    contentType.startsWith(prefix)
  );
}

/* -------------------------------------------------------------------------- */
/* Response exclusion rules                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Check whether Cache-Control contains the no-transform directive.
 *
 * This directive tells intermediaries not to transform the response.
 * Respecting it also makes the middleware predictable for application
 * responses that explicitly prohibit transformations.
 */
function hasNoTransformDirective(res) {
  const cacheControl = String(
    res.getHeader('Cache-Control') || ''
  ).toLowerCase();

  return /(?:^|,)\s*no-transform\s*(?:,|$)/.test(cacheControl);
}

/**
 * Detect responses that should not be compressed.
 */
function shouldSkipResponse(req, res) {
  const headers = req.headers || {};

  // Explicit application-level opt-out.
  // The presence of the header disables compression.
  if (headers['x-no-compression'] !== undefined) {
    return true;
  }

  // Do not interfere with HEAD responses.
  if (req.method === 'HEAD') {
    return true;
  }

  const statusCode = Number(res.statusCode);

  // Responses without a body.
  if (
    statusCode === 204 ||
    statusCode === 304 ||
    statusCode === 205
  ) {
    return true;
  }

  // Partial responses must preserve their range semantics.
  if (
    statusCode === 206 ||
    res.getHeader('Content-Range') !== undefined
  ) {
    return true;
  }

  // Do not transform responses explicitly marked as immutable.
  if (hasNoTransformDirective(res)) {
    return true;
  }

  const contentType = normalizeContentType(
    res.getHeader('Content-Type')
  );

  // Server-Sent Events must remain unbuffered.
  if (contentType === 'text/event-stream') {
    return true;
  }

  // Skip images, media, archives, PDFs, and other compressed formats.
  if (isAlreadyCompressed(contentType)) {
    return true;
  }

  // Avoid attempting to compress an already encoded response.
  if (res.getHeader('Content-Encoding') !== undefined) {
    return true;
  }

  return false;
}

/* -------------------------------------------------------------------------- */
/* Compression filter                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Decide whether a response should be compressed.
 *
 * The compression package's default filter remains responsible for:
 * - Accept-Encoding negotiation
 * - Content-Type compressibility
 * - Other library-specific checks
 *
 * @param {import('express').Request} req
 * @param {import('express').Response} res
 * @returns {boolean}
 */
export function shouldCompress(req, res) {
  if (!req || !res || typeof res.getHeader !== 'function') {
    return false;
  }

  if (shouldSkipResponse(req, res)) {
    return false;
  }

  return compression.filter(req, res);
}

/* -------------------------------------------------------------------------- */
/* Middleware                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Configured Express compression middleware.
 *
 * Features:
 * - Configurable compression threshold
 * - Configurable compression level
 * - Client Accept-Encoding negotiation
 * - Already-compressed content exclusion
 * - Streaming and SSE protection
 * - Partial response protection
 * - Explicit per-request opt-out
 */
export const compressionMiddleware = compression({
  threshold: COMPRESSION_THRESHOLD_BYTES,
  level: COMPRESSION_LEVEL,
  filter: shouldCompress,
});

export default compressionMiddleware;
