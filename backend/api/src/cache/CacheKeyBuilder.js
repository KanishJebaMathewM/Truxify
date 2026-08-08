/**
 * Versioned, namespace-aware cache key builder.
 *
 * Generates deterministic Redis keys following the pattern:
 *   {namespace}:{version}:{entity}:{identifier}[:{subKey}]
 *
 * Version numbers are maintained in Redis so that incrementing the
 * version effectively invalidates all keys under that namespace+entity
 * combination without scanning.
 *
 * Usage:
 *   import { CacheKeyBuilder } from './CacheKeyBuilder.js';
 *   const key = CacheKeyBuilder.build('profile', 'sb:abc123');
 *   // => 'profile:v1:sb:abc123'
 *
 *   const pattern = CacheKeyBuilder.pattern('profile', 'sb:abc123');
 *   // => 'profile:*:sb:abc123'
 */

import { CacheNamespace } from './CacheNamespace.js';
import logger from '../middleware/logger.js';

const SEP = ':';

export const CacheKeyBuilder = {
  /**
   * Build a cache key for the given namespace, entity ID and optional sub-key.
   *
   * @param {string} namespace — must be a registered namespace name
   * @param {string} entityId — primary identifier (e.g. userId, orderId)
   * @param {string} [subKey] — optional sub-entity (e.g. 'stats', 'driver')
   * @returns {string} fully-qualified Redis key
   */
  build(namespace, entityId, subKey) {
    const ns = CacheNamespace.get(namespace);
    if (!ns) {
      logger.warn(`[CacheKeyBuilder] Unknown namespace "${namespace}" — building key without namespace validation.`);
    }
    const prefix = ns?.prefix || namespace;
    const parts = [prefix, entityId];
    if (subKey) parts.push(subKey);
    return parts.join(SEP);
  },

  /**
   * Build a versioned cache key. The version is looked up from Redis
   * and appended to the key so that bumping the version invalidates
   * all previous keys.
   *
   * @param {string} namespace
   * @param {string} entityId
   * @param {string} [subKey]
   * @param {number} [version] — if provided, skips Redis lookup
   * @returns {string} versioned Redis key
   */
  buildVersioned(namespace, entityId, subKey, version) {
    const ns = CacheNamespace.get(namespace);
    const prefix = ns?.prefix || namespace;
    const v = version != null ? version : 1;
    const parts = [prefix, `v${v}`, entityId];
    if (subKey) parts.push(subKey);
    return parts.join(SEP);
  },

  /**
   * Return the Redis key used to store the version counter for a
   * namespace + entity combination.
   *
   * @param {string} namespace
   * @param {string} entityId
   * @param {string} [subKey]
   * @returns {string}
   */
  versionKey(namespace, entityId, subKey) {
    const ns = CacheNamespace.get(namespace);
    const prefix = ns?.prefix || namespace;
    const parts = [prefix, 'version', entityId];
    if (subKey) parts.push(subKey);
    return parts.join(SEP);
  },

  /**
   * Build a SCAN-compatible glob pattern for invalidating all keys
   * under a namespace + entity prefix. Matches the unversioned keys
   * produced by build()/buildWithPrefix() (and their sub-keys), e.g.
   * `prefix:entity*` matches `prefix:entity`, `prefix:entity:123`,
   * and `prefix:entity:123:stats`.
   *
   * @param {string} namespace
   * @param {string} [entityId] — if omitted, matches the entire namespace
   * @returns {string} glob pattern e.g. 'profile:*' or 'profile:sb:abc123*'
   */
  pattern(namespace, entityId) {
    const ns = CacheNamespace.get(namespace);
    const prefix = ns?.prefix || namespace;
    if (entityId) {
      return `${prefix}:${entityId}*`;
    }
    return `${prefix}:*`;
  },

  /**
   * Return the Pub/Sub channel name for cache invalidation events
   * in the given namespace.
   *
   * @param {string} namespace
   * @returns {string}
   */
  pubSubChannel(namespace) {
    return `cache:invalidate:${namespace}`;
  },

  /**
   * Parse a cache key back into its components.
   *
   * @param {string} key
   * @returns {{ namespace: string, version: string|null, entityId: string, subKey: string|null }}
   */
  parse(key) {
    const parts = key.split(SEP);
    return {
      namespace: parts[0] || null,
      version: parts[1]?.startsWith('v') ? parts[1] : null,
      entityId: parts[1]?.startsWith('v') ? parts[2] : parts[1] || null,
      subKey: parts[1]?.startsWith('v')
        ? (parts.length > 3 ? parts.slice(3).join(SEP) : null)
        : (parts.length > 2 ? parts.slice(2).join(SEP) : null),
    };
  },
};

export default CacheKeyBuilder;
