import { ethers } from 'ethers';

/**
 * States for the RPC Circuit Breaker.
 */
export const CIRCUIT_STATES = {
  CLOSED: 'CLOSED',       // Normal operation, primary RPC active
  OPEN: 'OPEN',           // Primary RPC failing, circuit tripped to fallback
  HALF_OPEN: 'HALF_OPEN'   // Cooldown elapsed, probing primary RPC
};

export class RpcProviderManager {
  /**
   * @param {Object} [options]
   * @param {string[]} [options.rpcUrls] Array of RPC URLs (primary first, followed by fallbacks)
   * @param {number} [options.failureThreshold] Consecutive failures before tripping breaker (default: 3)
   * @param {number} [options.cooldownMs] Cooldown duration in OPEN state before testing HALF_OPEN (default: 10000ms)
   * @param {number} [options.requestTimeoutMs] Request timeout in ms (default: 5000ms)
   */
  constructor(options = {}) {
    const defaultUrls = [
      process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com',
      ...(process.env.POLYGON_FALLBACK_RPC_URLS
        ? process.env.POLYGON_FALLBACK_RPC_URLS.split(',').map((u) => u.trim())
        : ['https://rpc-mainnet.maticvigil.com', 'https://polygon.llamarpc.com'])
    ].filter(Boolean);

    this.rpcUrls = options.rpcUrls || defaultUrls;
    this.failureThreshold = options.failureThreshold || 3;
    this.cooldownMs = options.cooldownMs || 10000;
    this.requestTimeoutMs = options.requestTimeoutMs || 5000;

    this.primaryIndex = 0;
    this.consecutiveFailures = 0;
    this.state = CIRCUIT_STATES.CLOSED;
    this.lastStateChangeTime = Date.now();

    this._providers = this.rpcUrls.map((url) => new ethers.JsonRpcProvider(url));
  }

  /**
   * Returns the current active provider based on circuit breaker state.
   * @returns {ethers.JsonRpcProvider}
   */
  getProvider() {
    this._checkStateTransition();
    if (this.state === CIRCUIT_STATES.OPEN) {
      // Use secondary fallback provider if available
      const fallbackIndex = (this.primaryIndex + 1) % this._providers.length;
      return this._providers[fallbackIndex];
    }
    return this._providers[this.primaryIndex];
  }

  /**
   * Records a successful request, resetting failure counts and closing circuit if HALF_OPEN.
   */
  recordSuccess() {
    this.consecutiveFailures = 0;
    if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.state = CIRCUIT_STATES.CLOSED;
      this.lastStateChangeTime = Date.now();
    }
  }

  /**
   * Records a failed request, incrementing failure counter and tripping circuit if threshold reached.
   */
  recordFailure() {
    this.consecutiveFailures++;
    if (
      this.state === CIRCUIT_STATES.CLOSED &&
      this.consecutiveFailures >= this.failureThreshold
    ) {
      this.state = CIRCUIT_STATES.OPEN;
      this.lastStateChangeTime = Date.now();
    } else if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this.state = CIRCUIT_STATES.OPEN;
      this.lastStateChangeTime = Date.now();
    }
  }

  /**
   * Evaluates state transitions (OPEN -> HALF_OPEN after cooldown).
   * @private
   */
  _checkStateTransition() {
    if (
      this.state === CIRCUIT_STATES.OPEN &&
      Date.now() - this.lastStateChangeTime >= this.cooldownMs
    ) {
      this.state = CIRCUIT_STATES.HALF_OPEN;
      this.lastStateChangeTime = Date.now();
    }
  }

  /**
   * Executes an asynchronous RPC contract call with automatic retry, exponential backoff, and circuit breaking.
   * @param {Function} fn Function accepting (provider) and returning Promise
   * @param {Object} [retryOptions]
   * @param {number} [retryOptions.maxRetries] Max retry attempts (default: 3)
   * @param {number} [retryOptions.initialDelayMs] Base delay in ms (default: 300ms)
   * @returns {Promise<any>}
   */
  async executeWithRetry(fn, retryOptions = {}) {
    const maxRetries = retryOptions.maxRetries ?? 3;
    const initialDelayMs = retryOptions.initialDelayMs ?? 300;

    let lastError = null;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const provider = this.getProvider();
      try {
        const result = await fn(provider);
        this.recordSuccess();
        return result;
      } catch (err) {
        lastError = err;
        this.recordFailure();

        if (attempt < maxRetries) {
          const delay = initialDelayMs * Math.pow(2, attempt) + Math.random() * 100;
          await new Promise((res) => setTimeout(res, delay));
        }
      }
    }
    throw lastError;
  }
}

export const defaultRpcManager = new RpcProviderManager();
