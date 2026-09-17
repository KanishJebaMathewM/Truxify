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
 * Fail-closed semantics: the pause flag is an emergency control. If Redis is
 * unreachable (or the read throws), the pause state cannot be confirmed, so
 * isEscrowPaused() treats the state as PAUSED and on-chain escrow submissions
 * are refused. Operators must restore/verify Redis and the pause state before
 * normal escrow operation resumes.
 */

import logger from '../middleware/logger.js';
import { redisClient } from '../config/db.js';
import { CircuitBreaker, CircuitState } from '../lib/circuitBreaker.js';

export { CircuitBreaker, CircuitState };

export const escrowBreaker = new CircuitBreaker('escrow', {
  failureThreshold: 3,
  resetTimeoutMs: 10000,
  requestTimeoutMs: 5000,
});

const PAUSE_KEY = 'escrow:circuit-breaker:paused';
const PAUSED_AT_KEY = 'escrow:circuit-breaker:paused-at';

/**
 * Whether the escrow circuit breaker is open. This is an emergency control:
 * when the Redis-backed pause state cannot be read (Redis unavailable or the
 * read fails), the state is treated as paused — escrow submissions fail closed
 * until Redis is restored and the pause state is verified.
 *
 * @returns {Promise<boolean>} — true when the escrow circuit breaker is open
 */
export async function isEscrowPaused() {
  if (!redisClient) {
    return true;
  }
  try {
    const value = await redisClient.get(PAUSE_KEY);
    return value === '1';
  } catch (err) {
    logger.error(
      { err: err?.message ?? String(err), event: 'ESCROW_CIRCUIT_BREAKER_READ_ERROR' },
      '[escrow-circuit-breaker] Failed to read pause flag from Redis — failing closed (treating as paused).'
    );
    return true;
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
    return { paused: true, pausedAt: null, stateUnknown: true };
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
      '[escrow-circuit-breaker] Failed to read pause state — reporting as paused.'
    );
    return { paused: true, pausedAt: null, stateUnknown: true };
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
