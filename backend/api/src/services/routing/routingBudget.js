import logger from '../../middleware/logger.js';

/** Caller ownership for advisory cache, HTTP bodies and retry waits. */
export function boundedMilliseconds(value, fallback, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.max(1, Math.min(Math.floor(parsed), maximum)) : fallback;
}

function deadlineError(message = 'OSRM routing budget expired') {
  const error = new Error(message);
  error.code = 'E_OSRM_BUDGET';
  return error;
}

export class RoutingBudget {
  constructor(timeoutMs) {
    this.deadline = performance.now() + timeoutMs;
    this.controller = new AbortController();
    this.closed = false;
    this.timer = setTimeout(() => this.expire(), timeoutMs);
  }

  get signal() { return this.controller.signal; }
  remaining() { return Math.max(0, this.deadline - performance.now()); }
  expire() { if (!this.signal.aborted) this.controller.abort(deadlineError()); }
  check() {
    if (this.remaining() <= 0) this.expire();
    if (this.closed || this.signal.aborted) throw deadlineError();
  }

  /** Race caller completion; Redis itself has no portable command cancellation. */
  async wait(operation, { timeoutMs, signal } = {}) {
    this.check();
    const combined = signal ? AbortSignal.any([this.signal, signal]) : this.signal;
    let timer;
    let onAbort;
    try {
      return await new Promise((resolve, reject) => {
        let settled = false;
        const finish = (fn, value) => {
          if (!settled) { settled = true; fn(value); }
        };
        onAbort = () => finish(reject, combined.reason || deadlineError());
        combined.addEventListener('abort', onAbort, { once: true });
        if (combined.aborted) { onAbort(); return; }
        if (timeoutMs !== undefined) {
          timer = setTimeout(() => finish(reject, deadlineError('OSRM advisory cache wait expired')),
            Math.max(1, Math.min(timeoutMs, this.remaining())));
        }
        Promise.resolve().then(() => {
          this.check();
          if (combined.aborted) throw combined.reason || deadlineError();
          return operation();
        }).then(value => {
          this.check();
          if (combined.aborted) throw combined.reason || deadlineError();
          finish(resolve, value);
        }).catch(error => finish(reject, error));
      });
    } finally {
      clearTimeout(timer);
      combined.removeEventListener('abort', onAbort);
    }
  }

  async delay(ms) {
    this.check();
    // Do not schedule a retry that cannot fit even its backoff in the budget.
    if (ms >= this.remaining()) throw deadlineError('OSRM retry wait exceeds remaining budget');
    let timer;
    try {
      await this.wait(() => new Promise(resolve => { timer = setTimeout(resolve, ms); }));
    } finally { clearTimeout(timer); }
  }

  dispose() {
    this.closed = true;
    clearTimeout(this.timer);
    this.expire();
  }
}

export async function withRoutingBudget(task) {
  const totalMs = boundedMilliseconds(process.env.OSRM_TOTAL_TIMEOUT_MS, 5000, 30000);
  const budget = new RoutingBudget(totalMs);
  try { return await budget.wait(() => task(budget)); }
  catch (error) {
    logger.warn({ code: error?.code, message: error?.message }, '[OSRM] Routing budget ended without a result');
    return null;
  }
  finally { budget.dispose(); }
}
