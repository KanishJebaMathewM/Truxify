import { context, trace, SpanStatusCode } from '@opentelemetry/api';
import tracing from '../../tracing/tracing.js';
import { TraceContext } from './TraceContext.js';
import { ContextPropagator } from './ContextPropagator.js';
import spanFactory, { STANDARD_ATTRIBUTES } from './SpanFactory.js';

export const enhancedTracingMiddleware = (req, res, next) => {
  if (req.path === '/health' || req.path === '/metrics' || req.path === '/favicon.ico') {
    return next();
  }

  req._startTime = Date.now();
  const tracer = tracing.getTracer();
  const span = tracer.startSpan(`HTTP ${req.method} ${req.path}`, {
    attributes: {
      'http.method': req.method,
      'http.url': req.url,
      'http.path': req.path,
      'http.user_agent': req.headers['user-agent'],
      'http.client_ip': req.ip,
      'request.id': req.requestId,
      'correlation.id': req.correlationId,
    },
  });

  const ctx = trace.setSpan(context.active(), span);
  context.with(ctx, () => {
    req.span = span;
    req.traceId = span.spanContext().traceId;
    req.spanId = span.spanContext().spanId;

    req._traceSnapshot = ContextPropagator.snapshot();

    res.setHeader('X-Trace-Id', req.traceId);

    req.traceContext = {
      traceId: req.traceId,
      spanId: req.spanId,
      snapshot: req._traceSnapshot,
    };

    next();

    res.on('finish', () => {
      span.setAttributes({
        'http.status_code': res.statusCode,
        'http.response_time_ms': Date.now() - req._startTime,
      });

      if (res.statusCode >= 400) {
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: `HTTP ${res.statusCode}`,
        });
      } else {
        span.setStatus({ code: SpanStatusCode.OK });
      }

      span.end();
    });

    res.on('error', (error) => {
      spanFactory.recordError(span, error);
      span.end();
    });
  });
};

export const createWorkerContextFromRequest = (req) => {
  if (!req?._traceSnapshot) return {};
  return { traceSnapshot: req._traceSnapshot };
};

export const propagateContextToBackground = (req, options = {}) => {
  if (!req?._traceSnapshot) return null;

  const snapshot = req._traceSnapshot;
  const correlationId = req.correlationId;

  return {
    traceSnapshot: snapshot,
    correlationId,
    traceId: req.traceId,
    source: options.source || 'http-request',
  };
};

export const restoreBackgroundContext = (contextData, fn) => {
  if (!contextData?.traceSnapshot) return fn();

  return ContextPropagator.restore(contextData.traceSnapshot, async () => {
    const span = spanFactory.startWorkerSpan(contextData.source || 'background-task', {
      attributes: {
        'correlation.id': contextData.correlationId,
        'parent.trace_id': contextData.traceId,
      },
    });

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
};
