import tracing from '../tracing/tracing.js';
import { context, trace } from '@opentelemetry/api';
import logger from './logger.js';

export const tracingMiddleware = (req, res, next) => {
    // Skip tracing for health endpoints
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
            'http.user_agent': req.headers['user-agent'] || 'unknown',
            'http.client_ip': req.ip || req.socket?.remoteAddress || 'unknown',
            'request.id': req.requestId || 'unknown',
        }
    });

    // Set correlation context
    const ctx = trace.setSpan(context.active(), span);
    context.with(ctx, () => {
        // Add span to request for downstream use
        req.span = span;
        
        // Store trace ID for logging
        const traceId = span.spanContext().traceId;
        req.traceId = traceId;
        
        // Add trace headers to response
        res.setHeader('X-Trace-Id', traceId);

        // Add trace to logger
        req.log = logger.child({ traceId });

        // Continue request
        next();

        // End span after response
        res.on('finish', () => {
            const durationMs = Date.now() - req._startTime;
            span.setAttributes({
                'http.status_code': res.statusCode,
                'http.response_time_ms': durationMs,
            });
            
            if (res.statusCode >= 400) {
                span.setStatus({
                    code: 2, // ERROR status
                    message: `HTTP ${res.statusCode}`
                });
            } else {
                span.setStatus({ code: 1 }); // OK status
            }
            
            span.end();
        });

        res.on('error', (error) => {
            span.recordException(error);
            span.setStatus({
                code: 2,
                message: error.message
            });
            span.end();
        });
    });
};

export const sqlTracingMiddleware = (query, params) => {
    const span = tracing.createSpan('SQL Query');
    if (span) {
        tracing.addAttributes(span, {
            'db.system': 'postgresql',
            'db.statement': query,
            'db.bind_params': JSON.stringify(params || []),
        });
        tracing.addEvent(span, 'sql.query.started');
        return span;
    }
    return null;
};

export const cacheTracingMiddleware = (operation, key) => {
    const span = tracing.createSpan(`Redis ${operation}`);
    if (span) {
        tracing.addAttributes(span, {
            'cache.operation': operation,
            'cache.key': key,
        });
        return span;
    }
    return null;
};

export const mongoTracingMiddleware = (operation, collection) => {
    const span = tracing.createSpan(`MongoDB ${operation}`);
    if (span) {
        tracing.addAttributes(span, {
            'db.system': 'mongodb',
            'db.operation': operation,
            'db.collection': collection,
        });
        return span;
    }
    return null;
};

export const webSocketTracingMiddleware = (event, socketId) => {
    const span = tracing.createSpan(`WebSocket ${event}`);
    if (span) {
        tracing.addAttributes(span, {
            'websocket.event': event,
            'websocket.socket_id': socketId || 'unknown',
        });
        tracing.addEvent(span, 'websocket.message.received');
        return span;
    }
    return null;
};

export const traceAsyncSpan = async (spanName, attributes = {}, asyncFn) => {
    const tracer = tracing.getTracer();
    const span = tracer.startSpan(spanName, { attributes });
    const startTime = Date.now();

    try {
        const result = await asyncFn(span);
        span.setAttributes({
            'execution.time_ms': Date.now() - startTime,
        });
        span.setStatus({ code: 1 }); // OK
        return result;
    } catch (err) {
        span.recordException(err);
        span.setStatus({ code: 2, message: err.message }); // ERROR
        throw err;
    } finally {
        span.end();
    }
};