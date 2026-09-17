/**
 * @typedef {Object} IdempotencyConfig
 * @property {number} ttlSeconds - Time to live for the idempotency cache in seconds.
 * @property {number} lockTtlMs - Time to live for the distributed lock in milliseconds.
 * @property {number} maxInMemoryEntries - Maximum number of entries in the in-memory store.
 */

/**
 * @typedef {Object} IdempotencyCacheEntry
 * @property {number} statusCode - The HTTP status code of the cached response.
 * @property {any} body - The response body to be returned.
 */

/**
 * @typedef {Object} IdempotencyRequest
 * @property {string} [idempotencyKey] - The validated idempotency key attached to the request.
 */

/**
 * Validates the format of an idempotency key.
 * @param {string} key - The key to validate.
 * @returns {boolean} True if the key is valid, false otherwise.
 */
export function isValidIdempotencyKey(key) {
    if (typeof key !== 'string') return false;
    return /^[a-zA-Z0-9_-]{1,255}$/.test(key);
}

/**
 * Generates a cache key for the idempotency store.
 * @param {import('express').Request} req - The Express request object.
 * @param {string} idempotencyKey - The validated idempotency key.
 * @returns {string} The formatted cache key.
 */
export function generateIdempotencyCacheKey(req, idempotencyKey) {
    const identity = req.user?.id || 'anonymous';
    return `idempotency:${identity}:${req.method}:${req.originalUrl}:${idempotencyKey}`;
}
