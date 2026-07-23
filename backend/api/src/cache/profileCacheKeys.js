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
 */

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
