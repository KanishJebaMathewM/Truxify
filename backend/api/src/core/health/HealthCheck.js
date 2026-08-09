import logger from '../../middleware/logger.js';

const DEFAULT_TIMEOUT_MS = 400;
const SLOW_THRESHOLD_MS = 500;

/**
 * Status constants for individual health checks.
 */
export const HealthStatus = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
  UNKNOWN: 'unknown',
};

/**
 * Wrap a promise with a timeout.
 */
export function withTimeout(promise, ms = DEFAULT_TIMEOUT_MS) {
  let timer;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`healthcheck timeout after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => clearTimeout(timer));
}

/**
 * Execute a single health check with timing, timeout, and error handling.
 *
 * @param {string} name - Human-readable service name
 * @param {Function} checkFn - Async function that resolves to a status string
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs] - Per-check timeout override
 * @param {boolean} [opts.critical=false] - Whether failure degrades overall health
 * @returns {Promise<import('./HealthAggregator.js').ServiceHealthResult>}
 */
export async function executeCheck(name, checkFn, { timeoutMs = DEFAULT_TIMEOUT_MS, critical = false } = {}) {
  const start = Date.now();
  try {
    const result = await withTimeout(checkFn(), timeoutMs);
    const responseTime = Date.now() - start;

    if (responseTime > SLOW_THRESHOLD_MS) {
      logger.warn(`[health] Slow dependency: ${name} responded in ${responseTime}ms (threshold: ${SLOW_THRESHOLD_MS}ms)`);
    }

    return {
      name,
      status: result?.status ?? HealthStatus.HEALTHY,
      message: result?.message,
      metadata: result?.metadata,
      responseTime,
      critical,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    const responseTime = Date.now() - start;
    logger.error(`[health] Check failed: ${name} — ${err.message}`);

    return {
      name,
      status: HealthStatus.UNHEALTHY,
      message: err.message,
      responseTime,
      critical,
      timestamp: new Date().toISOString(),
    };
  }
}
