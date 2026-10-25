/**
 * Audit-log signing secret configuration.
 *
 * Centralizes the HMAC key used to sign and verify immutable audit-log batches
 * so the service that writes them and the route that verifies them never read
 * process.env directly and never fall back to a hardcoded secret.
 *
 * Background: both call sites previously used
 *   process.env.AUDIT_SIGNING_SECRET || 'truxify-audit-signing-secret'
 * That literal is committed to a public repository, so anyone can recompute a
 * valid signature for a forged audit batch and `POST /api/audit/verify` accepts
 * it. The tamper-evidence guarantee was therefore cosmetic.
 *
 * Fail-closed contract:
 *   - In production, AUDIT_SIGNING_SECRET must be set and at least
 *     MIN_SECRET_LENGTH characters long. There is no fallback: getAuditSigningSecret()
 *     throws and no batch is signed or verified with a known key.
 *   - Outside production a random per-process secret is generated once and
 *     cached, so local development and tests work without a shared default
 *     while still refusing to use a publicly known key. Signatures issued
 *     before a restart do not survive it, which is the intended local behaviour.
 */

import crypto from 'crypto';
import logger from '../middleware/logger.js';

/**
 * Minimum accepted length for a configured AUDIT_SIGNING_SECRET, in characters.
 * Matches the floor already used for JWT_SECRET and WIM_SIGNING_SECRET.
 */
export const MIN_SECRET_LENGTH = 32;

/** Number of random bytes used for the non-production fallback secret. */
const FALLBACK_SECRET_BYTES = 48;

let cachedFallbackSecret = null;

/**
 * Returns the configured audit-log signing secret.
 *
 * The secret is read lazily so a configuration failure surfaces as a
 * fail-closed error at signing/verification time even if no startup
 * validation ran (for example in a script that imports a route module
 * directly).
 *
 * @returns {string} The secret to sign and verify audit-log batches with.
 * @throws {Error} If AUDIT_SIGNING_SECRET is missing or too short in production.
 */
export function getAuditSigningSecret() {
  const raw = process.env.AUDIT_SIGNING_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';

  if (secret) {
    if (secret.length < MIN_SECRET_LENGTH) {
      throw new Error(
        `AUDIT_SIGNING_SECRET must be at least ${MIN_SECRET_LENGTH} characters long.`,
      );
    }
    return secret;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'AUDIT_SIGNING_SECRET environment variable is required in production to sign and verify audit-log batches.',
    );
  }

  // Outside production there is no shared default. Generate one per process so
  // that a missing variable can never degrade into a publicly known key.
  if (!cachedFallbackSecret) {
    cachedFallbackSecret = crypto.randomBytes(FALLBACK_SECRET_BYTES).toString('hex');
    logger.warn(
      '[config/auditSigningSecret] AUDIT_SIGNING_SECRET is not set. Generated a random per-process signing secret. Signatures will not survive a restart, and every instance will use a different key. Set AUDIT_SIGNING_SECRET explicitly.',
    );
  }
  return cachedFallbackSecret;
}

/**
 * Returns true when a usable audit-log signing secret is available.
 * @returns {boolean}
 */
export function hasAuditSigningSecret() {
  try {
    getAuditSigningSecret();
    return true;
  } catch (_err) {
    return false;
  }
}

/**
 * Test seam: clears the cached non-production fallback so a test can observe a
 * freshly generated secret. Has no effect on a configured AUDIT_SIGNING_SECRET.
 */
export function resetAuditSigningSecretCache() {
  cachedFallbackSecret = null;
}
