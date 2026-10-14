// Prometheus/OpenTelemetry-compatible metrics wrapper for the auth stack.
class MetricsService {
  constructor() {
    this.counters = {
      authSuccess: 0,
      authFailure: 0,
      authConfigMissing: 0,
      rateLimitExceeded: 0,
      hmacFailure: 0,
      scopeUnauthorized: 0,
    };
  }

  increment(metricName, tags = {}) {
    if (this.counters[metricName] !== undefined) {
      this.counters[metricName]++;
    }
    // Integration point for Prometheus / Datadog
    if (process.env.ENABLE_STATSD === 'true') {
      // e.g. statsd.increment(`api_auth.${metricName}`, tags);
    }
  }

  getMetrics() {
    return { ...this.counters, timestamp: new Date().toISOString() };
  }
}

export const metrics = new MetricsService();