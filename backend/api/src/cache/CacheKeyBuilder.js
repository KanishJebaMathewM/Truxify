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

/** Bounded timeout (ms) for the Redis version lookup in buildVersioned. */
const DEFAULT_VERSION_TIMEOUT_MS = 500;

/** Redis client used for the live version lookup. Wired via CacheManager.init. */
let redisClient = null;

/**
 * Register the Redis client used for version lookups.
 *
 * @param {object|null} client — ioredis instance (or null to clear)
 */
function _setRedisClient(client) {
  redisClient = client;
}

/**
 * Resolve a promise but bound it to a timeout. A late rejection after the
 * timeout fires is swallowed so it can never surface as an unhandled rejection.
 *
 * @param {PromiseLike<*>} promise
 * @param {number} timeoutMs
 * @returns {Promise<*>}
 */
function _boundedRead(promise, timeoutMs) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    Promise.resolve(promise).catch(() => null).then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}

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
   * Build a versioned cache key. The current version is read live from
   * Redis (see versionKey) and appended to the key, so bumping the version
   * invalidates all previously built keys. Falls back to `v1` only when the
   * read fails, times out, or no Redis client is configured.
   *
   * @param {string} namespace
   * @param {string} entityId
   * @param {string} [subKey]
   * @param {number} [version] — if provided, skips the Redis lookup
   * @param {object} [opts]
   * @param {string} [opts.versionKey] — custom version key to read instead
   * @param {number} [opts.timeoutMs] — bounded timeout for the Redis read
   * @returns {Promise<string>} versioned Redis key
   */
  async buildVersioned(namespace, entityId, subKey, version, opts = {}) {
    const ns = CacheNamespace.get(namespace);
    const prefix = ns?.prefix || namespace;
    let v = version;
    if (v == null) {
      const client = redisClient;
      if (client) {
        try {
          const versionKey = opts.versionKey || this.versionKey(namespace, entityId, subKey);
          const raw = await _boundedRead(client.get(versionKey), opts.timeoutMs ?? DEFAULT_VERSION_TIMEOUT_MS);
          const parsed = raw != null ? parseInt(raw, 10) : 1;
          v = Number.isNaN(parsed) ? 1 : parsed;
        } catch (err) {
          logger.warn({ err }, `[CacheKeyBuilder] Failed to read version for namespace "${namespace}" — falling back to v1.`);
          v = 1;
        }
      } else {
        v = 1;
      }
    }
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
    if (!key) {
      return { namespace: null, version: null, entityId: null, subKey: null };
    }
    // Namespaces can be multi-segment ('user:profile') — match the longest
    // registered prefix so build() output round-trips; fall back to the
    // first segment for unknown namespaces.
    // CacheNamespace.all() returns a Map — spread its values first.
    const prefixes = [...CacheNamespace.all().values()]
      .map((ns) => ns.prefix)
      .sort((a, b) => b.length - a.length);
    const nsPrefix = prefixes.find((p) => key === p || key.startsWith(p + SEP)) || null;
    const rest = nsPrefix ? key.slice(nsPrefix.length + 1) : key;
    const parts = rest.split(SEP);

    let namespace;
    let body;
    let version = null;
    if (nsPrefix) {
      namespace = nsPrefix;
      if (parts[0]?.startsWith('v')) { version = parts[0]; body = parts.slice(1); }
      else body = parts;
    } else {
      namespace = parts[0] || null;
      if (parts[1]?.startsWith('v')) { version = parts[1]; body = parts.slice(2); }
      else body = parts.slice(1);
    }

    // Entity ids have a namespace-specific width: profile entities are
    // 'sb:<id>' pairs (2 segments); everything else is a single segment.
    // Anything beyond the entity is the subKey.
    const entityWidth = nsPrefix === 'user:profile' ? 2 : 1;
    const entityId = body.slice(0, entityWidth).join(SEP) || null;
    const subKey = body.length > entityWidth ? body.slice(entityWidth).join(SEP) : null;

    return { namespace, version, entityId, subKey };
  },

  /**
   * Register (or clear) the Redis client used for version lookups.
   * Wired automatically by CacheManager.init.
   *
   * @param {object|null} client — ioredis instance
   */
  _setRedisClient(client) {
    _setRedisClient(client);
  },
};

export default CacheKeyBuilder;
