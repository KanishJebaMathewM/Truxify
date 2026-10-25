/**
 * XFetch: Optimal Probabilistic Early Expiration Algorithm for Cache Pre-Warming
 * 
 * Based on the optimal cache pre-computation algorithm (Vattani, Chierichetti, Lowenstein):
 *   delta * beta * ln(U) > expiry - currentTime
 * 
 * Where:
 *  - delta: computation duration in milliseconds to compute the cached value
 *  - beta: precomputation aggression multiplier (beta >= 0, default 1.0)
 *  - U: uniform random variable in (0, 1]
 *  - expiry: absolute timestamp (ms) when cache item expires
 *  - currentTime: current timestamp (ms)
 * 
 * When this condition is met, the cache triggers an asynchronous early refresh
 * before the item expires, preventing dogpiling/cache stampedes under high load.
 */

/**
 * Evaluates whether a cached entry should be early-recomputed.
 * 
 * @param {number} expiryTimestampMs - Absolute expiry timestamp in milliseconds
 * @param {number} [deltaMs=0] - Time taken to compute the value in milliseconds
 * @param {number} [beta=1.0] - Aggression factor (>= 0). 0 disables early refresh, >1 makes it more aggressive
 * @param {number} [nowMs=Date.now()] - Current timestamp in milliseconds (injected for testing/reproducibility)
 * @returns {boolean} True if the value should be recomputed asynchronously
 */
export function shouldRecompute(expiryTimestampMs, deltaMs = 0, beta = 1.0, nowMs = Date.now()) {
  if (!Number.isFinite(expiryTimestampMs)) {
    return false;
  }

  const remainingTtlMs = expiryTimestampMs - nowMs;

  // Hard expired
  if (remainingTtlMs <= 0) {
    return true;
  }

  // If beta <= 0 or delta <= 0, probabilistic early refresh is disabled
  if (!Number.isFinite(beta) || beta <= 0 || !Number.isFinite(deltaMs) || deltaMs <= 0) {
    return false;
  }

  // Draw uniform random U in (0, 1] - guard against 0 to avoid ln(0) = -Infinity
  const u = Math.max(Math.random(), 1e-10);

  // XFetch threshold: delta * beta * ln(U) is <= 0 since ln(U) <= 0 for U in (0, 1]
  // Because delta * beta * ln(U) is negative, multiplying by -1 gives:
  // -delta * beta * ln(U) < expiry - now
  // Rearranging standard formula: (now - delta * beta * ln(U)) >= expiry
  const threshold = deltaMs * beta * Math.log(u);

  return threshold > remainingTtlMs;
}

/**
 * Calculates remaining TTL in milliseconds.
 * 
 * @param {number} expiryTimestampMs - Absolute expiry timestamp in milliseconds
 * @param {number} [nowMs=Date.now()] - Current timestamp
 * @returns {number} Remaining TTL in milliseconds (clamped to >= 0)
 */
export function getRemainingTtl(expiryTimestampMs, nowMs = Date.now()) {
  if (!Number.isFinite(expiryTimestampMs)) {
    return 0;
  }
  return Math.max(0, expiryTimestampMs - nowMs);
}

export default {
  shouldRecompute,
  getRemainingTtl,
};
