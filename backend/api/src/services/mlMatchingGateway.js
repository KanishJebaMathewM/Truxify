import { performance } from 'node:perf_hooks';
import logger from '../middleware/logger.js';

/** Matching-only admission: no waiting queue, bounded live operations, one probe. */
export class MlMatchingGateway {
  constructor({ deadlineMs = 2500, maxInFlight = 8, failureThreshold = 5,
    cooldownMs = 30000, now = () => performance.now() } = {}) {
    for (const value of [deadlineMs, maxInFlight, failureThreshold, cooldownMs]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new TypeError('Invalid matching gateway bound');
    }
    this.deadlineMs = deadlineMs;
    this.maxInFlight = maxInFlight;
    this.failureThreshold = failureThreshold;
    this.cooldownMs = cooldownMs;
    this.now = now;
    this.state = 'CLOSED';
    this.generation = 0;
    this.failures = 0;
    this.inFlight = 0;
    this.retryAt = 0;
    this.probeInFlight = false;
  }

  snapshot() {
    return { state: this.state, inFlight: this.inFlight, failures: this.failures,
      probeInFlight: this.probeInFlight };
  }

  transition(state) {
    this.state = state;
    logger.info({ state, inFlight: this.inFlight }, '[ML matching] Admission circuit transition');
  }

  async execute(operation) {
    if (typeof operation !== 'function') throw new TypeError('Matching operation must be a function');
    if (this.state === 'OPEN') {
      if (this.now() < this.retryAt) throw new Error('[ML] Matching circuit is open');
      this.transition('HALF_OPEN');
    }
    if (this.probeInFlight || this.inFlight >= this.maxInFlight) {
      throw new Error('[ML] Matching admission capacity unavailable');
    }
    const generation = this.generation;
    const probe = this.state === 'HALF_OPEN';
    if (probe) this.probeInFlight = true;
    this.inFlight += 1;
    const controller = new AbortController();
    let timer;
    // Keep capacity until the underlying operation actually settles, even if
    // an adapter ignores abort. Timed-out callers must not create unbounded work.
    const work = Promise.resolve().then(() => operation(controller.signal));
    work.then(() => { this.inFlight -= 1; }, () => { this.inFlight -= 1; });
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('[ML] Matching dependency deadline exceeded'));
      }, this.deadlineMs);
    });
    try {
      const result = await Promise.race([work, deadline]);
      if (generation === this.generation) {
        this.failures = 0;
        if (probe) {
          this.generation += 1;
          this.probeInFlight = false;
          this.transition('CLOSED');
        }
      }
      return result;
    } catch (error) {
      if (generation === this.generation) {
        this.failures += 1;
        if (probe || this.failures >= this.failureThreshold) {
          this.generation += 1;
          this.probeInFlight = false;
          this.retryAt = this.now() + this.cooldownMs;
          this.transition('OPEN');
        }
      }
      throw new Error('[ML] Matching dependency unavailable', { cause: error });
    } finally {
      clearTimeout(timer);
    }
  }
}

export const mlMatchingGateway = new MlMatchingGateway();
