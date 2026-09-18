export const MIN_KEYS = 10;
export const MAX_KEYS = 100000;

/**
 * Clamp the configured LRU cache max key count into a safe range.
 *
 * Values below MIN_KEYS are raised to the minimum. Values above MAX_KEYS are
 * capped to the maximum. Non-finite values use a safe fallback.
 *
 * @param {number} maxKeys
 * @param {number} [fallback=1000]
 * @returns {number}
 */
export function clampMaxKeys(maxKeys, fallback = 1000) {
  const safeFallback = Number.isFinite(fallback) ? fallback : 1000;

  if (Number.isNaN(maxKeys)) {
    return safeFallback;
  }

  if (Object.is(maxKeys, Number.POSITIVE_INFINITY)) {
    return MAX_KEYS;
  }

  if (Object.is(maxKeys, Number.NEGATIVE_INFINITY)) {
    return MIN_KEYS;
  }

  if (!Number.isFinite(maxKeys)) {
    return safeFallback;
  }

  if (maxKeys < MIN_KEYS) {
    return MIN_KEYS;
  }

  if (maxKeys > MAX_KEYS) {
    return MAX_KEYS;
  }

  return maxKeys;
}
