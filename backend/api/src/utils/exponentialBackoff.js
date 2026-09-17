class ExponentialBackoff {
  constructor(options = {}) {
    this.maxRetries = options.maxRetries || 5;
    this.baseDelay = options.baseDelay || 1000; 
    this.maxDelay = options.maxDelay || 30000; 
    this.factor = options.factor || 2;
    this.jitter = options.jitter !== undefined ? options.jitter : true;
  }

  async execute(fn) {
    let lastError;
    let delay = this.baseDelay;

    for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        console.warn(`Attempt ${attempt}/${this.maxRetries} failed: ${error.message}`);

        if (attempt === this.maxRetries) {
          break;
        }

        let currentDelay = delay;
        if (this.jitter) {
          const randomJitter = Math.random() * 0.3 * delay;
          currentDelay += randomJitter;
        }

        console.log(`Retrying in ${Math.round(currentDelay)}ms...`);
        await this.sleep(currentDelay);
        
        delay = Math.min(delay * this.factor, this.maxDelay);
      }
    }

    throw new Error(`Operation failed after ${this.maxRetries} attempts. Last error: ${lastError.message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      if (this.state === 'HALF-OPEN') {
        console.log(`Circuit breaker '${this.name}' transitioning to CLOSED`);
        this.state = 'CLOSED';
      }
    }

    onFailure() {
      this.failureCount++;
      this.lastFailureTime = Date.now();

      if (this.failureCount >= this.failureThreshold) {
        console.warn(`Circuit breaker '${this.name}' transitioning to OPEN due to ${this.failureCount} failures`);
        this.state = 'OPEN';
      }
    }

    getState() {
      if (this.state === 'OPEN' && Date.now() - this.lastFailureTime > this.resetTimeout) {
        return 'HALF-OPEN';
      }
      return this.state;
    }
  }

module.exports = CircuitBreaker;
module.exports.default = CircuitBreaker;
module.exports.CircuitBreaker = CircuitBreaker;