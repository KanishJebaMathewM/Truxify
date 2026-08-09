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

    this.state = CircuitState.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.nextAttempt = Date.now();
    this._halfOpenTimer = null;
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
    this.nextAttempt = Date.now();
  }

  async execute(fn, ...args) {
    const currentState = this.getState();

    if (currentState === CircuitState.OPEN) {
      logger.warn(`[CircuitBreaker:${this.name}] Request rejected, circuit is OPEN`);
      if (typeof this.fallback === 'function') {
        return this.fallback(...args);
      }
      throw new Error(`CircuitBreaker:${this.name} is OPEN`);
    }

    let timer;
    try {
      const timeoutPromise = new Promise((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`[CircuitBreaker:${this.name}] Request timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
        timer.unref?.();
      });

      const result = await Promise.race([fn(...args), timeoutPromise]);
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
    if (this.state === CircuitState.HALF_OPEN) {
      this.reset();
      logger.info(`[CircuitBreaker:${this.name}] Service recovered. State reset to CLOSED`);
    } else {
      this.failureCount = 0;
    }
  }

  onFailure(err, args) {
    this.failureCount += 1;
    logger.error({ err: err.message, failures: this.failureCount }, `[CircuitBreaker:${this.name}] Execution failure`);

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
}
