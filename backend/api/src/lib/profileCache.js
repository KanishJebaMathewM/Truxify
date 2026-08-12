import * as db from "../config/db.js";
import logger from "../middleware/logger.js";
import {
  firebaseProfileKey,
  supabaseProfileKey,
  customerStatsKey,
  driverDetailsKey,
  firebaseProfileVersionKey,
  supabaseProfileVersionKey,
} from "../cache/profileCacheKeys.js";

let _publishFn = null;
let _pubSubChecked = false;

async function _publishProfileInvalidation(eventOpts) {
  if (!_pubSubChecked) {
    _pubSubChecked = true;
    try {
      const { publishInvalidation } =
        await import("../cache/CachePublisher.js");
      _publishFn = publishInvalidation;
    } catch (err) {
      logger.warn({ err }, 'Failed to initialize pub/sub publisher — profile invalidation events will not be broadcast.');
      _publishFn = null;
    }
  }
  if (_publishFn) {
    _publishFn("profile", eventOpts).catch((err) => {
      logger.warn(
        { err, eventOpts },
        "Failed to publish profile invalidation event",
      );
    });
  }
}

export const TTL_SECONDS = parseInt(process.env.REDIS_CACHE_TTL || "120", 10); // 2 minutes default so role/status changes (suspension, demotion) propagate quickly
export const TOMBSTONE_TTL_SECONDS = 30; // 30 seconds

let cacheHits = 0;
let cacheMisses = 0;
let cacheSets = 0;

export function getCacheStats() {
  // Snapshot all counters in one read to avoid inconsistent intermediate sums
  const hits = cacheHits;
  const misses = cacheMisses;
  const sets = cacheSets;
  const total = hits + misses;
  return {
    hits,
    misses,
    sets,
    total,
    hitRate: total > 0 ? ((hits / total) * 100).toFixed(1) + '%' : '0%',
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
    logger.error(
      { operation, error: errorDetails },
      "Redis cache error (throttled)",
    );
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
  } catch (err) {
    logger.warn({ err }, 'Failed to get Redis client in getRedisClient — falling back to null.');
    return null;
  }
}

/**
 * Validates the shape of a cached profile.
 *
 * @param {string} firebaseUid - The expected Firebase UID.
 * @param {object|null} cachedProfile - The cached profile to validate.
 *   Must have: isActive (boolean), uid (string matching firebaseUid), id (string),
 *   role (string). Optional: fullName (string|null), phone (string|null), updatedAt (string|null).
 * @returns {boolean} True if the cached profile shape is valid, false otherwise.
 */
export function isValidCachedProfile(firebaseUid, cachedProfile) {
  if (typeof firebaseUid !== 'string' || !firebaseUid.trim()) {
    return false;
  }
  if (
    !cachedProfile ||
    typeof cachedProfile !== 'object' ||
    Array.isArray(cachedProfile)
  ) {
    return false;
  }

  // Reject objects with unexpected fields to enforce strict schema
  const ALLOWED_FIELDS = new Set([
    'isActive', 'uid', 'id', 'role',
    'fullName', 'phone', 'updatedAt',
  ]);
  const profileKeys = Object.keys(cachedProfile);
  for (const key of profileKeys) {
    if (!ALLOWED_FIELDS.has(key)) {
      return false;
    }
  }
  if (typeof cachedProfile.isActive !== "boolean") {
    return false;
  }
  // Tombstone (inactive) is valid
  if (cachedProfile.isActive === false) {
    return true;
  }
  // Active profile must have uid matching the expected Firebase UID
  if (cachedProfile.uid !== firebaseUid) {
    return false;
  }
  if (typeof cachedProfile.id !== "string" || !cachedProfile.id) {
    return false;
  }
  if (typeof cachedProfile.role !== "string" || !cachedProfile.role) {
    return false;
  }
  if (
    cachedProfile.fullName !== undefined &&
    cachedProfile.fullName !== null &&
    typeof cachedProfile.fullName !== "string"
  ) {
    return false;
  }
  if (
    cachedProfile.phone !== undefined &&
    cachedProfile.phone !== null &&
    typeof cachedProfile.phone !== "string"
  ) {
    return false;
  }
  return true;
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
  if (typeof userId !== "string" || !userId.trim()) {
    return false;
  }
  if (
    !cachedProfile ||
    typeof cachedProfile !== "object" ||
    Array.isArray(cachedProfile)
  ) {
    return false;
  }
  if (typeof cachedProfile.isActive !== "boolean") {
    return false;
  }
  if (cachedProfile.isActive === false) {
    return true; // Valid tombstone
  }
  return (
    cachedProfile.isActive === true &&
    cachedProfile.id === userId &&
    typeof cachedProfile.role === "string" &&
    (cachedProfile.fullName === undefined ||
      cachedProfile.fullName === null ||
      typeof cachedProfile.fullName === "string") &&
    (cachedProfile.phone === undefined ||
      cachedProfile.phone === null ||
      typeof cachedProfile.phone === "string")
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
      const parsed = JSON.parse(raw);
      // A corrupted payload that parses to a non-object (e.g. "42", "null",
      // "some string") must not be treated as a valid cached profile.
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        cacheMisses++;
        await redisClient.del(firebaseProfileKey(firebaseUid)).catch(() => {});
        return null;
      }
      // Version check: ensure cached profile matches current version in Redis.
      // If version mismatch, treat as miss and delete stale entry (issue #11182).
      const currentVersion = await redisClient.get(firebaseProfileVersionKey(firebaseUid));
      if (currentVersion && parsed._version !== currentVersion) {
        cacheMisses++;
        await Promise.all([
          redisClient.del(firebaseProfileKey(firebaseUid)),
          redisClient.del(firebaseProfileVersionKey(firebaseUid)),
        ]).catch(() => {});
        return null;
      }
      cacheHits++;
      return parsed;
    }
    cacheMisses++;
    return null;
  } catch (err) {
    logCacheError("getCachedProfile", err);
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
export async function setCachedProfile(
  firebaseUid,
  profile,
  ttlSeconds = TTL_SECONDS,
) {
  const redisClient = getRedisClient();
  if (!redisClient || !firebaseUid || !profile) return;
  // Clamp the TTL the same way the Supabase setters do: a non-positive TTL
  // would immediately expire the key, and an unbounded TTL could pin a
  // stale (e.g. deactivated) profile in cache for a very long time.
  if (!Number.isFinite(Number(ttlSeconds)) || ttlSeconds < 1) ttlSeconds = 1;
  if (ttlSeconds > 86400) ttlSeconds = 86400;
  try {
    // Fetch current version and store it with the profile for validation
    const version = await redisClient.incr(firebaseProfileVersionKey(firebaseUid));
    const profileWithVersion = { ...profile, _version: version };
    await redisClient.set(
      firebaseProfileKey(firebaseUid),
      JSON.stringify(profileWithVersion),
      "EX",
      ttlSeconds,
    );
    // Set version key with same TTL
    await redisClient.set(
      firebaseProfileVersionKey(firebaseUid),
      version,
      "EX",
      ttlSeconds,
    );
  } catch (err) {
    logCacheError("setCachedProfile", err);
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
    // Increment version to invalidate all existing cached profiles.
    // Any cached profile with the old _version will fail validation on read.
    await redisClient.incr(firebaseProfileVersionKey(firebaseUid));
    // Delete the profile key to force immediate refetch
    await redisClient.del(firebaseProfileKey(firebaseUid));
    _publishProfileInvalidation({
      type: "INVALIDATE_KEY",
      key: firebaseProfileKey(firebaseUid),
      entityId: firebaseUid,
    });
  } catch (err) {
    logCacheError("invalidateCachedProfile", err);
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
    if (raw) {
      const parsed = JSON.parse(raw);
      // Version check: ensure cached profile matches current version in Redis.
      // If version mismatch, treat as miss and delete stale entry (issue #11182).
      const currentVersion = await redisClient.get(supabaseProfileVersionKey(userId));
      if (currentVersion && parsed._version !== currentVersion) {
        await Promise.all([
          redisClient.del(supabaseProfileKey(userId)),
          redisClient.del(supabaseProfileVersionKey(userId)),
        ]).catch(() => {});
        return null;
      }
      return parsed;
    }
    return null;
  } catch (err) {
    logCacheError("getCachedSupabaseProfile", err);
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
export async function setCachedSupabaseProfile(
  userId,
  profile,
  ttlSeconds = TTL_SECONDS,
) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId || !profile) return;
  if (ttlSeconds < 1) ttlSeconds = 1;
  if (ttlSeconds > 86400) ttlSeconds = 86400;
  try {
    // Fetch current version and store it with the profile for validation
    const version = await redisClient.incr(supabaseProfileVersionKey(userId));
    const profileWithVersion = { ...profile, _version: version };
    await redisClient.set(
      supabaseProfileKey(userId),
      JSON.stringify(profileWithVersion),
      "EX",
      ttlSeconds,
    );
    // Set version key with same TTL
    await redisClient.set(
      supabaseProfileVersionKey(userId),
      version,
      "EX",
      ttlSeconds,
    );
  } catch (err) {
    logCacheError("setCachedSupabaseProfile", err);
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
    // Increment version to invalidate all existing cached profiles.
    // Any cached profile with the old _version will fail validation on read.
    await redisClient.incr(supabaseProfileVersionKey(userId));
    // Delete the profile key to force immediate refetch
    await redisClient.del(supabaseProfileKey(userId));
    _publishProfileInvalidation({
      type: "INVALIDATE_KEY",
      key: supabaseProfileKey(userId),
      entityId: userId,
    });
  } catch (err) {
    logCacheError("invalidateCachedSupabaseProfile", err);
  }
}

// ─── Profile Service Cache (getProfile / getCustomerStats / getDriverDetails) ──

/**
 * Retrieves cached customer stats from Redis.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {Promise<object|null>}
 */
export async function getCachedCustomerStats(userId) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId) return null;
  try {
    const raw = await redisClient.get(customerStatsKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logCacheError("getCachedCustomerStats", err);
    try {
      await redisClient.del(customerStatsKey(userId));
    } catch (_) {}
    return null;
  }
}

/**
 * Stores customer stats in the Redis cache.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @param {object} stats - The customer stats to cache.
 * @param {number} [ttlSeconds] - TTL in seconds.
 * @returns {Promise<void>}
 */
export async function setCachedCustomerStats(
  userId,
  stats,
  ttlSeconds = TTL_SECONDS,
) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId || !stats) return;
  if (ttlSeconds < 1) ttlSeconds = 1;
  if (ttlSeconds > 86400) ttlSeconds = 86400;
  try {
    await redisClient.set(
      customerStatsKey(userId),
      JSON.stringify(stats),
      "EX",
      ttlSeconds,
    );
  } catch (err) {
    logCacheError("setCachedCustomerStats", err);
  }
}

/**
 * Retrieves cached driver details from Redis.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {Promise<object|null>}
 */
export async function getCachedDriverDetails(userId) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId) return null;
  try {
    const raw = await redisClient.get(driverDetailsKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    logCacheError("getCachedDriverDetails", err);
    try {
      await redisClient.del(driverDetailsKey(userId));
    } catch (_) {}
    return null;
  }
}

/**
 * Stores driver details in the Redis cache.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @param {object} details - The driver details to cache.
 * @param {number} [ttlSeconds] - TTL in seconds.
 * @returns {Promise<void>}
 */
export async function setCachedDriverDetails(
  userId,
  details,
  ttlSeconds = TTL_SECONDS,
) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId || !details) return;
  if (ttlSeconds < 1) ttlSeconds = 1;
  if (ttlSeconds > 86400) ttlSeconds = 86400;
  try {
    await redisClient.set(
      driverDetailsKey(userId),
      JSON.stringify(details),
      "EX",
      ttlSeconds,
    );
  } catch (err) {
    logCacheError("setCachedDriverDetails", err);
  }
}

/**
 * Invalidates ALL cached Supabase profile data for a user:
 * profile, customer stats, and driver details.
 * Use this on any profile mutation to ensure no stale data is served.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {Promise<void>}
 */
export async function invalidateCachedSupabaseProfileAll(userId) {
  const redisClient = getRedisClient();
  if (!redisClient || !userId) return;
  try {
    // Increment version to invalidate all existing cached profiles.
    // Any cached profile with the old _version will fail validation on read.
    await Promise.all([
      redisClient.incr(supabaseProfileVersionKey(userId)),
      redisClient.del(supabaseProfileKey(userId)),
      redisClient.del(customerStatsKey(userId)),
      redisClient.del(driverDetailsKey(userId)),
    ]);
    _publishProfileInvalidation({
      type: "INVALIDATE_PATTERN",
      pattern: `user:profile:sb:${userId}*`,
      entityId: userId,
    });
  } catch (err) {
    logCacheError("invalidateCachedSupabaseProfileAll", err);
  }
}
