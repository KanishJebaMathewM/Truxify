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
        logger.warn({ attempt, maxRetries: this.maxRetries, err: error.message }, 'Retry attempt failed');

        if (attempt === this.maxRetries) {
          break;
        }

        let currentDelay = delay;
        if (this.jitter) {
          const randomJitter = Math.random() * 0.3 * delay;
          currentDelay += randomJitter;
        }

        logger.debug({ delayMs: Math.round(currentDelay) }, 'Retrying operation with backoff');
        await this.sleep(currentDelay);
        
        delay = Math.min(delay * this.factor, this.maxDelay);
      }
    }

    throw new Error(`Operation failed after ${this.maxRetries} attempts. Last error: ${lastError.message}`);
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default ExponentialBackoff;
export { ExponentialBackoff };