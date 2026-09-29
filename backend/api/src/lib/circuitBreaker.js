import logger from '../middleware/logger.js';

export const CircuitState = {
  CLOSED: 'CLOSED',
  OPEN: 'OPEN',
  HALF_OPEN: 'HALF_OPEN',
};

export class CircuitBreaker {
  constructor(name, options = {}) {
    this.name = name || 'defaultCircuitBreaker';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeoutMs = options.resetTimeoutMs || 30000;
    this.requestTimeoutMs = options.requestTimeoutMs || 5000;
    this.fallback = options.fallback || null;
    this.countTimeoutAsFailure = options.countTimeoutAsFailure ?? true;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.timeoutCount = 0;
    this.nextAttempt = Date.now();
    this._halfOpenTimer = null;
    this._halfOpenProbeInFlight = false;
  }

  _scheduleHalfOpen() {
    if (this._halfOpenTimer) {
      clearTimeout(this._halfOpenTimer);
    }

    this._halfOpenTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.state = CircuitState.HALF_OPEN;
        logger.info(
          `[CircuitBreaker:${this.name}] Transitioned from OPEN to HALF_OPEN via scheduled timer`,
        );
      }

      this._halfOpenTimer = null;
    }, this.resetTimeoutMs);

    // Do not keep the Node.js process alive just because this timer is pending.
    this._halfOpenTimer.unref?.();
  }

  getState() {
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttempt) {
      this.state = CircuitState.HALF_OPEN;
      logger.info(
        `[CircuitBreaker:${this.name}] Transitioned from OPEN to HALF_OPEN`,
      );
    }

    return this.state;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      timeoutCount: this.timeoutCount,
      nextAttempt: this.nextAttempt,
    };
  }

  reset() {
    if (this._halfOpenTimer) {
      clearTimeout(this._halfOpenTimer);
      this._halfOpenTimer = null;
    }

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.timeoutCount = 0;
    this.nextAttempt = Date.now();
    this._halfOpenProbeInFlight = false;
  }

  destroy() {
    this.reset();
  }

  // The timer is declared at function scope so the finally block can safely
  // clear it even if fn() throws synchronously.
  async execute(fn, ...args) {
    if (typeof fn !== 'function') {
      throw new TypeError('circuitBreaker execute: fn must be a function');
    }

    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      logger.warn(
        `[CircuitBreaker:${this.name}] Request rejected, circuit is OPEN`,
      );

      if (typeof this.fallback === 'function') {
        return this.fallback(...args);
      }

      throw new Error(`CircuitBreaker:${this.name} is OPEN`);
    }

    if (currentState === CircuitState.HALF_OPEN) {
      // Allow only one probe request while recovering.
      if (this._halfOpenProbeInFlight) {
        logger.warn(
          `[CircuitBreaker:${this.name}] Probe already in flight, rejecting extra HALF_OPEN request`,
        );

        if (typeof this.fallback === 'function') {
          return this.fallback(...args);
        }

        throw new Error(
          `CircuitBreaker:${this.name} is HALF_OPEN (probe in flight)`,
        );
      }

      this._halfOpenProbeInFlight = true;
    }

    let timer;
    const controller = new AbortController();
    const { signal } = controller;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          this.timeoutCount += 1;

          // Abort the underlying operation so it cannot continue running
          // after the circuit breaker has already timed out.
          controller.abort();

          reject(
            new Error(
              `[CircuitBreaker:${this.name}] Request timed out after ${this.requestTimeoutMs}ms`,
            ),
          );
        }, this.requestTimeoutMs);

        timer.unref?.();
      });

      // Pass the AbortSignal to the wrapped function.
      const result = await Promise.race([
        fn(...args, { signal }),
        timeoutPromise,
      ]);

      this.onSuccess();

      return result;
    } catch (err) {
      return this.onFailure(err, args);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  onSuccess() {
    this.successCount += 1;

    if (this.state === CircuitState.HALF_OPEN) {
      this.reset();

      logger.info(
        `[CircuitBreaker:${this.name}] Service recovered. State reset to CLOSED`,
      );
    } else {
      this.failureCount = 0;
    }
  }

  onFailure(err, args) {
    const errMessage = err instanceof Error ? err.message : String(err);

    const isTimeout =
      err instanceof Error &&
      errMessage.includes('Request timed out');

    // A timeout can be recorded without opening/tripping the circuit when
    // countTimeoutAsFailure is disabled.
    if (isTimeout && !this.countTimeoutAsFailure) {
      logger.warn(
        {
          err: errMessage,
          timeouts: this.timeoutCount,
        },
        `[CircuitBreaker:${this.name}] Execution timed out without counting as circuit failure`,
      );

      this._halfOpenProbeInFlight = false;

      if (typeof this.fallback === 'function') {
        return this.fallback(...args);
      }

      throw err;
    }

    this.failureCount += 1;

    logger.error(
      {
        err: errMessage,
        failures: this.failureCount,
      },
      `[CircuitBreaker:${this.name}] Execution failure`,
    );

    if (
      this.state === CircuitState.HALF_OPEN ||
      this.failureCount >= this.failureThreshold
    ) {
      this.state = CircuitState.OPEN;
      this._halfOpenProbeInFlight = false;
      this.nextAttempt = Date.now() + this.resetTimeoutMs;

      this._scheduleHalfOpen();

      logger.warn(
        `[CircuitBreaker:${this.name}] Circuit opened until ${new Date(
          this.nextAttempt,
        ).toISOString()}`,
      );
    }

    if (typeof this.fallback === 'function') {
      return this.fallback(...args);
    }

    throw err;
  }
}
