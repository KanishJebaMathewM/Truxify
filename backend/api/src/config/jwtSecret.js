/**
 * JWT signing secret configuration.
 *
 * Centralizes the backend JWT signing key so the route that issues tokens and
 * the middleware that verifies them never read process.env directly and never
 * fall back to a hardcoded secret.
 *
 * Background: both call sites previously used
 *   process.env.JWT_SECRET || 'truxify-jwt-secret-key'
 * That literal is committed to a public repository, and neither the production
 * compose file nor the .env example required JWT_SECRET to be set. A
 * deployment that missed the variable therefore signed and accepted every
 * backend JWT with a publicly known key, which is enough to forge an admin
 * token that `requireRole` trusts.
 *
 * Fail-closed contract:
 *   - In production, JWT_SECRET must be set and at least MIN_SECRET_LENGTH
 *     characters long. There is no fallback: getJwtSecret() throws, and
 *     index.js fails fast at startup. No token is signed or verified.
 *   - Outside production a random per-process secret is generated once and
 *     cached, so local development and tests work without a shared default
 *     while still refusing to use a publicly known key. Tokens issued before a
 *     restart do not survive it, which is the intended local behaviour.
 */

import crypto from 'crypto';
import logger from '../middleware/logger.js';

/**
 * Minimum accepted length for a configured JWT_SECRET, in characters.
 * Matches the floor already used for WIM_SIGNING_SECRET.
 */
export const MIN_SECRET_LENGTH = 32;

/** Number of random bytes used for the non-production fallback secret. */
const FALLBACK_SECRET_BYTES = 48;

let cachedFallbackSecret = null;

/**
 * Returns the configured JWT signing secret.
 *
 * The secret is read lazily so a configuration failure surfaces as a
 * fail-closed error at signing/verification time even if the startup
 * validation in index.js did not run (for example in a test harness or a
 * script that imports a route module directly).
 *
 * @returns {string} The secret to sign and verify backend JWTs with.
 * @throws {Error} If JWT_SECRET is missing or too short in production.
 */
export function getJwtSecret() {
  const raw = process.env.JWT_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';

  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `JWT_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'JWT_SECRET environment variable is required in production to sign and verify backend JWTs.',
    );
  }

  // Outside production there is no shared default. Generate one per process so
  // that a missing variable can never degrade into a publicly known key.
  if (!cachedFallbackSecret) {
    cachedFallbackSecret = crypto.randomBytes(FALLBACK_SECRET_BYTES).toString('hex');
    logger.warn(
      '[config/jwtSecret] JWT_SECRET is not set. Generated a random per-process signing secret. Tokens will not survive a restart, and every instance will use a different key. Set JWT_SECRET explicitly.',
    );
  }
  return cachedFallbackSecret;
}

/**
 * Returns true when a usable JWT signing secret is available.
 * @returns {boolean}
 */
export function hasJwtSecret() {
  try {
    getJwtSecret();
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Test seam: clears the cached non-production fallback so a test can observe a
 * freshly generated secret. Has no effect on a configured JWT_SECRET.
 */
export function resetJwtSecretCache() {
  cachedFallbackSecret = null;
}
