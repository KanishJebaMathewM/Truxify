import crypto from 'crypto';
import logger from '../middleware/logger.js';

// Revocation store for token families (in-memory Map with TTL/expiration capabilities)
const revokedFamilies = new Map(); // familyId -> { revokedAt, reason }
const familyGenerations = new Map(); // familyId -> currentGeneration

/**
 * Initializes tracking for a new token family.
 * @param {string} familyId Token family UUID
 * @param {number} [initialGen=0] Initial generation count
 */
export function registerTokenFamily(familyId, initialGen = 0) {
  if (!familyId) return;
  familyGenerations.set(familyId, initialGen);
}

/**
 * Checks if a token family has been revoked.
 * @param {string} familyId
 * @returns {boolean}
 */
export function isFamilyRevoked(familyId) {
  if (!familyId) return false;
  return revokedFamilies.has(familyId);
}

/**
 * Revokes an entire token family due to security compromise or logout.
 * @param {string} familyId
 * @param {string} [reason='SECURITY_COMPROMISE']
 */
export function revokeTokenFamily(familyId, reason = 'SECURITY_COMPROMISE') {
  if (!familyId) return;
  revokedFamilies.set(familyId, {
    revokedAt: new Date().toISOString(),
    reason,
  });
  familyGenerations.delete(familyId);
  logger.warn(
    { event: 'AUTH_FAMILY_REVOKED', familyId, reason },
    `[TokenFamily] Token family ${familyId} has been revoked: ${reason}`
  );
}

/**
 * Verifies a presented token generation against current family state and performs rotation.
 * If token reuse (replay attack) is detected, revokes the entire token family.
 *
 * @param {string} familyId Token family UUID
 * @param {number} presentedGen Presented generation number
 * @returns {{ valid: boolean, nextGen?: number, error?: string }}
 */
export function verifyAndRotateFamily(familyId, presentedGen) {
  if (!familyId) {
    return { valid: true, nextGen: 0 };
  }

  // 1. Check if family is already revoked
  if (isFamilyRevoked(familyId)) {
    return {
      valid: false,
      error: 'Token family has been revoked due to security compromise.',
    };
  }

  const currentGen = familyGenerations.get(familyId) ?? presentedGen;

  // 2. Token Reuse / Replay Attack Detection (presented generation is outdated)
  if (presentedGen < currentGen) {
    revokeTokenFamily(familyId, 'TOKEN_REUSE_DETECTED');
    logger.error(
      { event: 'AUTH_FAMILY_REUSE_DETECTED', familyId, presentedGen, currentGen },
      `[TokenFamily] Replay attack detected! Presented gen ${presentedGen} < current gen ${currentGen} for family ${familyId}`
    );
    return {
      valid: false,
      error: 'Token family reuse detected. All family sessions revoked.',
    };
  }

  // 3. Generation skipped or invalid
  if (presentedGen > currentGen) {
    revokeTokenFamily(familyId, 'INVALID_GENERATION_GAP');
    return {
      valid: false,
      error: 'Invalid token generation sequence.',
    };
  }

  // 4. Valid rotation: increment generation count
  const nextGen = currentGen + 1;
  familyGenerations.set(familyId, nextGen);

  return { valid: true, nextGen };
}

/**
 * Generates a new unique Token Family ID.
 * @returns {string}
 */
export function generateFamilyId() {
  return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
}

/**
 * Clears all in-memory family tracking (for test teardown).
 */
export function clearTokenFamilyStore() {
  revokedFamilies.clear();
  familyGenerations.clear();
}

export default {
  registerTokenFamily,
  isFamilyRevoked,
  revokeTokenFamily,
  verifyAndRotateFamily,
  generateFamilyId,
  clearTokenFamilyStore,
};
