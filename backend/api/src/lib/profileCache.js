import * as db from '../config/db.js';
import logger from '../middleware/logger.js';
import { firebaseProfileKey, supabaseProfileKey } from '../cache/profileCacheKeys.js';

export const TTL_SECONDS = 900; // 15 minutes
export const TOMBSTONE_TTL_SECONDS = 30; // 30 seconds

let cacheHits = 0;
let cacheMisses = 0;
let cacheSets = 0;

export function getCacheStats() {
  const total = cacheHits + cacheMisses;
  return {
    hits: cacheHits,
    misses: cacheMisses,
    sets: cacheSets,
    total,
    hitRate: total > 0 ? (cacheHits / total * 100).toFixed(1) + '%' : '0%',
  };
}

export function resetCacheStats() {
  cacheHits = 0;
  cacheMisses = 0;
  cacheSets = 0;
}

const LAST_LOG_TIMES = {};
const LOG_THROTTLE_INTERVAL_MS = 60000; // 60 seconds

/**
 * Throttles logging of cache errors on high-frequency paths to prevent flood.
 */
function logCacheError(operation, error) {
  const now = Date.now();
  const lastLog = LAST_LOG_TIMES[operation] || 0;
  if (now - lastLog >= LOG_THROTTLE_INTERVAL_MS) {
    LAST_LOG_TIMES[operation] = now;
    const errorDetails = error?.stack ?? error?.message ?? String(error);
    logger.error({ operation, error: errorDetails }, 'Redis cache error (throttled)');
  }
}

/**
 * Retrieves the redisClient from the database configuration.
 * Under Vitest, accessing a property on a mocked namespace module that is not explicitly
 * returned in the mock factory will throw an error via the mock Proxy. We wrap the access
 * in a try-catch to allow a graceful fallback to null.
 * 
 * @returns {object|null} The Redis client if configured, or null.
 */
function getRedisClient() {
  try {
    return db.redisClient ?? null;
  } catch {
    return null;
  }
}

/**
 * Validates the shape of a cached profile.
 * 
 * @param {string} firebaseUid - The expected Firebase UID.
 * @param {object|null} cachedProfile - The cached profile to validate.
 * @returns {boolean} True if the cached profile shape is valid, false otherwise.
 */
export function isValidCachedProfile(firebaseUid, cachedProfile) {
  if (!cachedProfile || typeof cachedProfile !== 'object' || Array.isArray(cachedProfile)) {
    return false;
  }
  if (typeof cachedProfile.isActive !== 'boolean') {
    return false;
  }
  if (cachedProfile.isActive === false) {
    return true; // Valid tombstone
  }
  return (
    cachedProfile.isActive === true &&
    cachedProfile.uid === firebaseUid &&
    typeof cachedProfile.id === 'string' &&
    typeof cachedProfile.role === 'string' &&
    (cachedProfile.fullName === undefined || cachedProfile.fullName === null || typeof cachedProfile.fullName === 'string') &&
    (cachedProfile.phone === undefined || cachedProfile.phone === null || typeof cachedProfile.phone === 'string')
  );
}

/**
 * Validates the shape of a cached Supabase profile.
 *
 * Supabase identities are keyed by the profile UUID (req.user.id) rather than
 * a Firebase UID, so the identity field checked here is `id`.
 *
 * @param {string} userId - The expected Supabase profile UUID.
 * @param {object|null} cachedProfile - The cached profile to validate.
 * @returns {boolean} True if the cached profile shape is valid, false otherwise.
 */
export function isValidCachedSupabaseProfile(userId, cachedProfile) {
  if (!cachedProfile || typeof cachedProfile !== 'object' || Array.isArray(cachedProfile)) {
    return false;
  }
  if (typeof cachedProfile.isActive !== 'boolean') {
    return false;
  }
  if (cachedProfile.isActive === false) {
    return true; // Valid tombstone
  }
  return (
    cachedProfile.isActive === true &&
    cachedProfile.id === userId &&
    typeof cachedProfile.role === 'string' &&
    (cachedProfile.fullName === undefined || cachedProfile.fullName === null || typeof cachedProfile.fullName === 'string') &&
    (cachedProfile.phone === undefined || cachedProfile.phone === null || typeof cachedProfile.phone === 'string')
  );
}

/**
 * Retrieves a user profile from the Redis cache.
 * Falls back to null on cache miss or Redis error.
 *
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @returns {Promise<object|null>} The parsed cached profile, or null.
 */
export async function getCachedProfile(firebaseUid) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid) {
    cacheMisses++;
    return null;
  }
  try {
    const raw = await redisClient.get(firebaseProfileKey(firebaseUid));
    if (raw) {
      cacheHits++;
      return JSON.parse(raw);
    }
    cacheMisses++;
    return null;
  } catch (err) {
    logCacheError('getCachedProfile', err);
    // On read or parsing failure, attempt a best-effort delete of the corrupted key
    try {
      await redisClient.del(firebaseProfileKey(firebaseUid));
    } catch (delErr) {
      // Ignore failures on background cleanup deletion
    }
    return null;
  }
}

/**
 * Stores a user profile in the Redis cache.
 * Gracefully handles Redis errors.
 * 
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @param {object} profile - The user profile object to cache.
 * @returns {Promise<void>}
 */
export async function setCachedProfile(firebaseUid, profile, ttlSeconds = TTL_SECONDS) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid || !profile) return;
  try {
    await redisClient.set(firebaseProfileKey(firebaseUid), JSON.stringify(profile), 'EX', ttlSeconds);
  } catch (err) {
    logCacheError('setCachedProfile', err);
  }
}

/**
 * Invalidates (deletes) a cached user profile from Redis.
 * Gracefully handles Redis errors.
 * 
 * @param {string} firebaseUid - The Firebase UID of the user.
 * @returns {Promise<void>}
 */
export async function invalidateCachedProfile(firebaseUid) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid) return;
  try {
    await redisClient.del(firebaseProfileKey(firebaseUid));
  } catch (err) {
    logCacheError('invalidateCachedProfile', err);
  }
}

/**
 * Retrieves a Supabase user profile from the Redis cache.
 * Falls back to null on cache miss or Redis error.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {Promise<object|null>} The parsed cached profile, or null.
 */
export async function getCachedSupabaseProfile(userId) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId) return null;
  try {
    const raw = await redisClient.get(supabaseProfileKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logCacheError('getCachedSupabaseProfile', err);
    try {
      await redisClient.del(supabaseProfileKey(userId));
    } catch (delErr) {
      // Ignore failures on background cleanup deletion
    }
    return null;
  }
}

/**
 * Stores a Supabase user profile in the Redis cache.
 * Gracefully handles Redis errors.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @param {object} profile - The user profile object to cache.
 * @param {number} [ttlSeconds] - TTL in seconds; callers should clamp this to
 *   the access token's remaining lifetime so a revoked session cannot outlive
 *   its token.
 * @returns {Promise<void>}
 */
export async function setCachedSupabaseProfile(userId, profile, ttlSeconds = TTL_SECONDS) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId || !profile) return;
  if (ttlSeconds < 1) ttlSeconds = 1;
  try {
    await redisClient.set(supabaseProfileKey(userId), JSON.stringify(profile), 'EX', ttlSeconds);
  } catch (err) {
    logCacheError('setCachedSupabaseProfile', err);
  }
}

/**
 * Invalidates (deletes) a cached Supabase user profile from Redis.
 * Gracefully handles Redis errors.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {Promise<void>}
 */
export async function invalidateCachedSupabaseProfile(userId) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId) return;
  try {
    await redisClient.del(supabaseProfileKey(userId));
  } catch (err) {
    logCacheError('invalidateCachedSupabaseProfile', err);
  }
}
