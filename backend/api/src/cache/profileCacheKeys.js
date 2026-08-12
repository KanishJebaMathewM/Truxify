/**
 * Centralized cache key management for user profiles.
 *
 * Every Redis key related to user profile caching MUST be generated through
 * the helpers in this module.  This eliminates duplicate key strings, prevents
 * naming inconsistencies, and gives a single place to audit or rename keys.
 *
 * Key namespace:
 *   user:profile:{firebaseUid}        — Firebase-keyed profiles
 *   user:profile:sb:{supabaseUserId}  — Supabase-keyed profiles
 *
 * The CacheKeyBuilder integration below provides namespace-aware key
 * generation for the new distributed cache invalidation system.
 * Existing key generation functions are preserved for backward compatibility.
 */

import { CacheKeyBuilder } from './CacheKeyBuilder.js';

/** Namespace prefix for all profile cache keys. */
export const PROFILE_KEY_PREFIX = 'user:profile';

/** Separator between namespace segments. */
const SEP = ':';

/**
 * Generate the Redis cache key for a Firebase-authenticated profile.
 *
 * @param {string} firebaseUid - The Firebase UID.
 * @returns {string} Redis key, e.g. `"user:profile:abc123"`
 */
export function firebaseProfileKey(firebaseUid) {
  return `${PROFILE_KEY_PREFIX}${SEP}${firebaseUid}`;
}

/**
 * Generate the Redis cache key for a Supabase-authenticated profile.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {string} Redis key, e.g. `"user:profile:sb:550e8400-..."`
 */
export function supabaseProfileKey(userId) {
  return `${PROFILE_KEY_PREFIX}${SEP}sb${SEP}${userId}`;
}

/**
 * Generate the Redis cache key for customer stats.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {string} Redis key, e.g. `"user:profile:sb:550e8400-...:stats"`
 */
export function customerStatsKey(userId) {
  return `${PROFILE_KEY_PREFIX}${SEP}sb${SEP}${userId}${SEP}stats`;
}

/**
 * Generate the Redis cache key for driver details.
 *
 * @param {string} userId - The Supabase profile UUID.
 * @returns {string} Redis key, e.g. `"user:profile:sb:550e8400-...:driver"`
 */
export function driverDetailsKey(userId) {
  return `${PROFILE_KEY_PREFIX}${SEP}sb${SEP}${userId}${SEP}driver`;
}

// ── CacheKeyBuilder integration ──────────────────────────────────────

/**
 * All known profile cache sub-keys. Used by the distributed cache
 * invalidation system to invalidate every cached profile entity
 * for a given user.
 */
export const PROFILE_SUB_KEYS = Object.freeze({
  STATS: 'stats',
  DRIVER: 'driver',
});

/**
 * Build a profile cache key using the CacheKeyBuilder.
 * Produces the same key format as the legacy functions above,
 * ensuring full backward compatibility.
 *
 * @param {string} userId
 * @param {string} [subKey] — e.g. 'stats' or 'driver'
 * @returns {string}
 */
export function profileCacheKey(userId, subKey) {
  return CacheKeyBuilder.build('profile', `sb:${userId}`, subKey);
}
