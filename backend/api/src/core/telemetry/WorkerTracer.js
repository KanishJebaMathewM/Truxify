import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import { ContextPropagator } from './ContextPropagator.js';
import spanFactory, { STANDARD_ATTRIBUTES } from './SpanFactory.js';

export class WorkerTracer {
  static createTracedWorker(workerName, handler, options = {}) {
    const maxAttempts = options.maxAttempts ?? 1;

    return async function tracedWorkerHandler(...args) {
      const parentSnapshot = ContextPropagator.snapshot();
      let lastError;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        let span;
        try {
          span = spanFactory.startWorkerSpan(workerName, {
            attributes: {
              [STANDARD_ATTRIBUTES.WORKER_ATTEMPT]: attempt,
              [STANDARD_ATTRIBUTES.WORKER_MAX_ATTEMPTS]: maxAttempts,
            },
          });

          const result = await context.with(trace.setSpan(context.active(), span), async () => {
            return await handler(...args);
          });

          span.setStatus({ code: SpanStatusCode.OK });
          span.end();
          return result;
        } catch (error) {
          lastError = error;
          if (span) {
            spanFactory.recordError(span, error);
            span.end();
          }

          if (attempt < maxAttempts) {
            const retryDelay = options.retryDelayMs ?? 1000;
            const retrySpan = spanFactory.startRetrySpan(workerName, attempt, maxAttempts, {
              attributes: { 'retry.delay_ms': retryDelay },
            });
            retrySpan.end();

            await new Promise(resolve => setTimeout(resolve, retryDelay));
          }
        }
      }

      throw lastError;
    };
  }

  static wrapCronJob(jobName, cronHandler, options = {}) {
    return async function tracedCronJob() {
      return spanFactory.withWorkerSpan(jobName, async () => {
        return await cronHandler();
      }, {
        attributes: {
          'job.schedule': options.schedule || 'unknown',
          'job.type': 'cron',
        },
      });
    };
  }

  static wrapIntervalWorker(workerName, handler, options = {}) {
    return async function tracedIntervalWorker() {
      return spanFactory.withWorkerSpan(workerName, async () => {
        return await handler();
      }, {
        attributes: {
          'worker.type': 'interval',
          'worker.interval_ms': options.intervalMs,
        },
      });
    };
  }

  static wrapChildProcess(workerName, handler, options = {}) {
    return async function tracedChildProcess(...args) {
      return spanFactory.withWorkerSpan(workerName, async () => {
        return await handler(...args);
      }, {
        attributes: {
          'worker.type': 'child_process',
        },
      });
    };
  }

  static async executeWithTraceContext(snapshot, fn) {
    return ContextPropagator.restore(snapshot, async () => {
      const span = spanFactory.startWorkerSpan('traced_continuation');
      try {
        const result = await context.with(trace.setSpan(context.active(), span), fn);
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (error) {
        spanFactory.recordError(span, error);
        span.end();
        throw error;
      }
    });
  }
}
