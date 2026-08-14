import crypto from 'crypto';

/**
 * OpenTelemetry W3C Trace Parent Generator & Middleware
 */
export class OtelTracerService {
  generateW3cTraceparent() {
    const traceId = crypto.randomBytes(16).toString('hex');
    const parentId = crypto.randomBytes(8).toString('hex');
    const flags = '01'; // Sampled
    return `00-${traceId}-${parentId}-${flags}`;
  }

  traceMiddleware(req, res, next) {
    const incomingTraceparent = req.headers['traceparent'] || this.generateW3cTraceparent();
    req.traceparent = incomingTraceparent;
    res.setHeader('traceparent', incomingTraceparent);
    if (next) next();
  }
}

export const otelTracer = new OtelTracerService();
