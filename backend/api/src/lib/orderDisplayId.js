import crypto from 'crypto';

// Order display ids look like `#FF<YYYYMMDD><12-char alphanumeric>` so they
// stay human-friendly while the random suffix is drawn uniformly from a 36
// char alphabet (A-Z, 0-9) via crypto.randomInt — no modulo bias. That gives
// 36^12 ≈ 4.7e18 distinct values per calendar day, versus only ~900k for the
// previous 6-digit format, so collisions are effectively impossible. Callers
// still re-roll on a DB unique-constraint violation (code 23505) as a safety
// net (see ORDER_DISPLAY_ID_MAX_RETRIES).
const DISPLAY_ID_PREFIX = '#FF';
const DISPLAY_ID_RANDOM_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const DISPLAY_ID_RANDOM_LENGTH = 12;

// Upper bound on how many times a caller will re-roll the display id when an
// insert fails with a unique-constraint violation (issue #5740).
export const ORDER_DISPLAY_ID_MAX_RETRIES = 5;

/**
 * Generate a globally unique order display id of the form
 * `#FF<YYYYMMDD><12-char alphanumeric>` (e.g. `#FF20260802K9X2Q7Z4M1A3`).
 *
 * The display id is the basis for the on-chain escrow booking id
 * (getEscrowBookingId hashes `escrow:<displayId>`), so uniqueness is required
 * to keep orders and their escrow bookings 1:1.
 *
 * @returns {string} a display id with a ~4.7e18-per-day random space
 */
export function generateOrderDisplayId() {
  const now = new Date();
  let dateStr;
  try {
    dateStr = now.toISOString().slice(0, 10).replace(/-/g, '');
  } catch (err) {
    // An invalid Date (e.g. a system clock that produced an out-of-range
    // value) makes toISOString throw; fall back to the Unix epoch day so the
    // id format stays stable and unique per day.
    dateStr = '19700101';
  }
  const random = Array.from(
    { length: DISPLAY_ID_RANDOM_LENGTH },
    () => DISPLAY_ID_RANDOM_ALPHABET[crypto.randomInt(DISPLAY_ID_RANDOM_ALPHABET.length)],
  ).join('');
  return `${DISPLAY_ID_PREFIX}${dateStr}${random}`;
}

export function isValidOrderDisplayId(displayId) {
  if (typeof displayId !== 'string') return false;
  return /^#FF\d{8}[A-Z0-9]{12}$/.test(displayId);
}

/**
 * Generate a client-supplied-style idempotency key (RFC 4122 v4 UUID) used to
 * make create_order_tx durable-idempotent. The key is stable for the lifetime
 * of a createOrder request (and its internal display-id retry loop) so that a
 * retried transaction returns the originally created order instead of
 * duplicating it (issue #11411).
 *
 * @returns {string} an RFC 4122 v4 UUID
 */
export function generateIdempotencyKey() {
  return crypto.randomUUID();
}
