/**
 * Escrow Circuit Breaker
 *
 * Backing store for the emergency smart-contract pause used by the n8n
 * circuit_breaker workflow (GET /api/internal/escrow-velocity and
 * POST /api/internal/pause-escrow).
 *
 * The pause flag is persisted in Redis so every API replica sees the same
 * state. All on-chain escrow submissions in services/escrow.js consult
 * isEscrowPaused() before building/sending a transaction.
 *
 * Fail-open semantics: if Redis is unreachable the flag cannot be read, so
 * escrow submissions proceed (a Redis outage must not freeze all payments).
 */

import logger from '../middleware/logger.js';
import { redisClient } from '../config/db.js';

const PAUSE_KEY = 'escrow:circuit-breaker:paused';
const PAUSED_AT_KEY = 'escrow:circuit-breaker:paused-at';

/**
 * @returns {Promise<boolean>} — true when the escrow circuit breaker is open
 */
export async function isEscrowPaused() {
  if (!redisClient) {
    return false;
  }
  try {
    const value = await redisClient.get(PAUSE_KEY);
    return value === '1';
  } catch (err) {
    logger.error(
      { err: err?.message ?? String(err), event: 'ESCROW_CIRCUIT_BREAKER_READ_ERROR' },
      '[escrow-circuit-breaker] Failed to read pause flag from Redis — failing open.'
    );
    return false;
  }
}

/**
 * Open or close the escrow circuit breaker.
 *
 * @param {boolean} paused
 * @returns {Promise<{paused: boolean, updatedAt: string}>}
 */
export async function setEscrowPaused(paused) {
  const now = new Date().toISOString();
  if (!redisClient) {
    logger.warn(
      '[escrow-circuit-breaker] Redis unavailable — pause state is not persisted.'
    );
    return { paused, updatedAt: now, persisted: false };
  }
  try {
    if (paused) {
      await redisClient.set(PAUSE_KEY, '1');
      await redisClient.set(PAUSED_AT_KEY, now);
      logger.warn(`[escrow-circuit-breaker] Circuit opened at ${now}`);
    } else {
      await redisClient.del(PAUSE_KEY);
      await redisClient.del(PAUSED_AT_KEY);
      logger.info(`[escrow-circuit-breaker] Circuit closed at ${now}`);
    }
    return { paused, updatedAt: now, persisted: true };
  } catch (err) {
    logger.error(
      { err: err?.message ?? String(err), event: 'ESCROW_CIRCUIT_BREAKER_WRITE_ERROR' },
      `[escrow-circuit-breaker] Failed to persist pause=${paused}.`
    );
    throw err;
  }
}

/**
 * @returns {Promise<{paused: boolean, pausedAt: string|null}>}
 */
export async function getPauseState() {
  if (!redisClient) {
    return { paused: false, pausedAt: null };
  }
  try {
    const [value, pausedAt] = await Promise.all([
      redisClient.get(PAUSE_KEY),
      redisClient.get(PAUSED_AT_KEY),
    ]);
    return { paused: value === '1', pausedAt: pausedAt || null };
  } catch (err) {
    logger.error(
      { err: err?.message ?? String(err), event: 'ESCROW_CIRCUIT_BREAKER_READ_ERROR' },
      '[escrow-circuit-breaker] Failed to read pause state — reporting as not paused.'
    );
    return { paused: false, pausedAt: null };
  }
}

/**
 * Result shape returned by escrow service functions when the circuit breaker
 * is open.
 *
 * @param {string} bookingId
 * @param {object} [extra={}]
 * @returns {object}
 */
export function escrowPausedResult(bookingId, extra = {}) {
  return {
    ...extra,
    bookingId,
    error: 'Escrow is paused by the circuit breaker.',
    code: 'ESCROW_PAUSED',
  };
}
