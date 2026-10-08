/**
 * Per-connection token bucket for Socket.IO / raw WebSocket message handlers.
 *
 * The HTTP side of this API is rate limited aggressively (apiLimiter,
 * userLimiter, per-endpoint limiters), but that protection does not extend to
 * socket messages: once a connection is upgraded, inbound frames never pass
 * through the Express middleware chain, so express-rate-limit cannot see them.
 *
 * That leaves any authenticated socket able to drive an unbounded number of
 * expensive server-side operations per second. Both realtime servers in this
 * codebase do real work per message - a MongoDB telemetry write plus a room
 * broadcast - so the unthrottled path is a resource-exhaustion and
 * data-integrity problem, not just wasted CPU:
 *
 *   - locationServer's location_update feeds a shared TelemetryRingBuffer sized
 *     TELEMETRY_BUFFER_MAX_SIZE (default 5000). That ring buffer overwrites its
 *     oldest entry on overflow, so a single flooding socket evicts other
 *     drivers' pending, legitimate location records.
 *   - Every message is broadcast to the booking room regardless of buffer state.
 *
 * Legitimate GPS cadences are far below the default ceiling: the server's own
 * heartbeat is WS_HEARTBEAT_INTERVAL_MS (15s), and mobile clients report every
 * few seconds. The defaults below therefore leave a wide margin while stopping
 * the flood.
 */
import { performance } from 'node:perf_hooks';

export const SOCKET_RATE_LIMIT_DEFAULTS = {
  /** Sustained messages per second allowed on one connection. */
  refillPerSecond: 5,
  /** Burst capacity, absorbing brief catch-up bursts (e.g. app resume). */
  capacity: 10,
  /**
   * Consecutive over-rate messages tolerated before the connection is treated as
   * abusive. Counted per connection and reset as soon as a message is accepted,
   * so only sustained flooding trips it - not a momentary burst.
   */
  maxOverRate: 100,
};

/**
 * Creates a token bucket bound to a single connection.
 *
 * @param {object} [options]
 * @param {number} [options.refillPerSecond] sustained rate; invalid values fall back
 *   to the safe default rather than disabling the guard
 * @param {number} [options.capacity] burst capacity
 * @param {number} [options.maxOverRate] over-rate messages before reporting abuse
 * @param {() => number} [options.now] elapsed millisecond clock injection point for tests
 */
export function createSocketRateLimiter(options = {}) {
  // Token refill measures elapsed time, independent of wall-clock adjustments.
  const now = options.now ?? (() => performance.now());

  let refillPerSecond = options.refillPerSecond ?? SOCKET_RATE_LIMIT_DEFAULTS.refillPerSecond;
  let capacity = options.capacity ?? SOCKET_RATE_LIMIT_DEFAULTS.capacity;
  const maxOverRate = options.maxOverRate ?? SOCKET_RATE_LIMIT_DEFAULTS.maxOverRate;

  if (!Number.isFinite(refillPerSecond) || refillPerSecond <= 0) {
    refillPerSecond = SOCKET_RATE_LIMIT_DEFAULTS.refillPerSecond;
  }
  if (!Number.isFinite(capacity) || capacity <= 0) capacity = SOCKET_RATE_LIMIT_DEFAULTS.capacity;

  let tokens = capacity;
  let lastRefill = now();
  let overRateCount = 0;

  function refill() {
    const current = now();
    const elapsedMs = current - lastRefill;
    if (elapsedMs <= 0) return;
    lastRefill = current;
    tokens = Math.min(capacity, tokens + (elapsedMs / 1000) * refillPerSecond);
  }

  return {
    /**
     * Attempts to consume one message's worth of budget.
     * @returns {boolean} true when the message may proceed
     */
    tryConsume() {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        overRateCount = 0;
        return true;
      }
      overRateCount += 1;
      return false;
    },

    /** True once the connection has exceeded maxOverRate in a row. */
    isAbusive() {
      return overRateCount > maxOverRate;
    },

    /** Consecutive over-rate messages observed so far. */
    getOverRateCount() {
      return overRateCount;
    },

    /** A valid configuration is always active; bad input never disables the guard. */
    isEnabled() {
      return refillPerSecond > 0 && capacity > 0;
    },
  };
}
