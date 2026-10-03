class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000;
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.lastFailureTime = null;
  }
  async execute(fn) {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.resetTimeout) {
        console.log(`Circuit breaker '${this.name}' transitioning to HALF-OPEN`);
        this.state = 'HALF-OPEN';
      } else {
        throw new Error(`Circuit breaker '${this.name}' is OPEN. Service unavailable.`);
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }
  onSuccess() {
    this.failureCount = 0;
  }
}

module.exports.default = CircuitBreaker;
