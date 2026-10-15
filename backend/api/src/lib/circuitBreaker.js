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
    this.countTimeoutAsFailure = options.countTimeoutAsFailure !== false;

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.timeoutCount = 0;
    this.nextAttempt = Date.now();
    this._halfOpenTimer = null;
    this._halfOpenProbeInFlight = false;
    this._probeToken = 0;
  }

  _scheduleHalfOpen() {
    if (this._halfOpenTimer) {
      clearTimeout(this._halfOpenTimer);
    }
    this._halfOpenTimer = setTimeout(() => {
      if (this.state === CircuitState.OPEN) {
        this.state = CircuitState.HALF_OPEN;
        logger.info(`[CircuitBreaker:${this.name}] Transitioned from OPEN to HALF_OPEN via scheduled timer`);
      }
      this._halfOpenTimer = null;
    }, this.resetTimeoutMs);
    this._halfOpenTimer?.unref?.();
  }

  getState() {
    if (this.state === CircuitState.OPEN && Date.now() >= this.nextAttempt) {
      this.state = CircuitState.HALF_OPEN;
      logger.info(`[CircuitBreaker:${this.name}] Transitioned from OPEN to HALF_OPEN`);
    }
    return this.state;
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
    this._probeToken = (this._probeToken || 0) + 1;
  }

  destroy() {
    this.reset();
  }

  async execute(fn, ...args) {
    if (typeof fn !== 'function') {
      throw new TypeError('circuitBreaker execute: fn must be a function');
    }
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      logger.warn(`[CircuitBreaker:${this.name}] Request rejected, circuit is OPEN`);
      if (typeof this.fallback === 'function') {
        return this.fallback(...args);
      }
      throw new Error(`CircuitBreaker:${this.name} is OPEN`);
    }

    let isProbe = false;
    let currentToken = null;

    if (currentState === CircuitState.HALF_OPEN) {
      if (this._halfOpenProbeInFlight) {
        logger.warn(`[CircuitBreaker:${this.name}] Probe already in flight, rejecting extra HALF_OPEN request`);
        if (typeof this.fallback === 'function') {
          return this.fallback(...args);
        }
        throw new Error(`CircuitBreaker:${this.name} is HALF_OPEN (probe in flight)`);
      }
      this._halfOpenProbeInFlight = true;
      isProbe = true;
      this._probeToken = (this._probeToken || 0) + 1;
      currentToken = this._probeToken;
    }

    const controller = new AbortController();
    const signal = controller.signal;

    let timer;
    let timedOut = false;

    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          timedOut = true;
          controller.abort();
          reject(new Error(`[CircuitBreaker:${this.name}] Request timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
        timer?.unref?.();
      });

      const userPromise = Promise.resolve().then(() => fn(...args, { signal }));

      userPromise
        .finally(() => {
          if (isProbe && this._probeToken === currentToken) {
            this._halfOpenProbeInFlight = false;
          }
        })
        .catch(() => {});

      const result = await Promise.race([userPromise, timeoutPromise]);
      this.onSuccess();
      return result;
    } catch (err) {
      if (timedOut) {
        this.timeoutCount += 1;
        logger.warn({ timeouts: this.timeoutCount }, `[CircuitBreaker:${this.name}] Request timed out`);
        if (this.countTimeoutAsFailure) {
          return this.onFailure(err, args);
        }
        throw err;
      }
      return this.onFailure(err, args);
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  onSuccess() {
    if (this.state === CircuitState.HALF_OPEN) {
      this.reset();
      this.successCount = 1;
      logger.info(`[CircuitBreaker:${this.name}] Service recovered. State reset to CLOSED`);
    } else {
      this.successCount += 1;
      this.failureCount = 0;
    }
  }

  onFailure(err, args) {
    this.failureCount += 1;
    const errMessage = err instanceof Error ? err.message : String(err);
    logger.error({ err: errMessage, failures: this.failureCount }, `[CircuitBreaker:${this.name}] Execution failure`);

    if (this.state === CircuitState.HALF_OPEN || this.failureCount >= this.failureThreshold) {
      this.state = CircuitState.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeoutMs;
      this._scheduleHalfOpen();
      logger.warn(`[CircuitBreaker:${this.name}] Circuit opened until ${new Date(this.nextAttempt).toISOString()}`);
    }

    if (typeof this.fallback === 'function') {
      return this.fallback(...args);
    }
    throw err;
  }

  getMetrics() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      timeoutCount: this.timeoutCount,
      successCount: this.successCount,
    };
  }
}
