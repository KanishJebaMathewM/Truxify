/**
 * Cache invalidation event definitions.
 *
 * Every invalidation that must be propagated across instances is
 * represented as a CacheEvent. Events are serialized to JSON and
 * published on the namespace-specific Redis Pub/Sub channel.
 *
 * Event types:
 *   - INVALIDATE_KEY   : delete a single key
 *   - INVALIDATE_PATTERN : delete all keys matching a glob
 *   - INVALIDATE_NAMESPACE : delete all keys in a namespace
 *   - BUMP_VERSION     : increment version counter, invalidating all versioned keys
 *   - REFRESH          : re-populate a key (informational, triggers a background reload)
 */

import crypto from 'crypto';
import logger from '../middleware/logger.js';

export const CacheEventType = Object.freeze({
  INVALIDATE_KEY: 'INVALIDATE_KEY',
  INVALIDATE_PATTERN: 'INVALIDATE_PATTERN',
  INVALIDATE_NAMESPACE: 'INVALIDATE_NAMESPACE',
  BUMP_VERSION: 'BUMP_VERSION',
  REFRESH: 'REFRESH',
});

/**
 * Create a cache invalidation event.
 *
 * @param {string} type — one of CacheEventType values
 * @param {object} opts
 * @param {string} opts.namespace — target namespace
 * @param {string} [opts.key] — specific Redis key (for INVALIDATE_KEY)
 * @param {string} [opts.pattern] — glob pattern (for INVALIDATE_PATTERN)
 * @param {string} [opts.entityId] — entity identifier
 * @param {string} [opts.subKey] — sub-entity key
 * @param {string} [opts.originInstanceId] — ID of the instance that originated the event
 * @param {number} [opts.timestamp] — event creation time (auto-set if omitted)
 * @returns {object} serialized event ready for JSON.stringify
 */
export function createCacheEvent(type, opts = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    namespace: opts.namespace,
    key: opts.key || null,
    pattern: opts.pattern || null,
    entityId: opts.entityId || null,
    subKey: opts.subKey || null,
    originInstanceId: opts.originInstanceId || null,
    timestamp: opts.timestamp || Date.now(),
  };
}

/**
 * Serialize a cache event to a JSON string for Pub/Sub publishing.
 *
 * @param {object} event — as returned by createCacheEvent
 * @returns {string}
 */
export function serializeCacheEvent(event) {
  return JSON.stringify(event);
}

/**
 * Deserialize a JSON string back into a cache event object.
 * Returns null if parsing fails.
 *
 * @param {string} json
 * @returns {object|null}
 */
export function deserializeCacheEvent(json) {
  try {
    const event = JSON.parse(json);
    if (!event || !event.type || !event.namespace) return null;
    return event;
  } catch (err) {
    logger.warn('[CacheEvent] Deserialization failed:', err?.message);
    return null;
  }
}

export default { CacheEventType, createCacheEvent, serializeCacheEvent, deserializeCacheEvent };
