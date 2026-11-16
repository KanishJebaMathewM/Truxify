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

    this._stateGeneration = 0;
    this._recoveryProbe = null;

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
      this._transitionTo(CIRCUIT_STATES.CLOSED);
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
      this._transitionTo(CIRCUIT_STATES.OPEN);
    } else if (this.state === CIRCUIT_STATES.HALF_OPEN) {
      this._transitionTo(CIRCUIT_STATES.OPEN);
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
      this._transitionTo(CIRCUIT_STATES.HALF_OPEN);
    }
  }

  /** Advance the health generation whenever the primary circuit changes state. */
  _transitionTo(state) {
    this.state = state;
    this.lastStateChangeTime = Date.now();
    this._stateGeneration++;
  }

  /** Capture feedback identity and reserve a single native recovery callback. */
  _beginAttempt() {
    this._checkStateTransition();
    const recovering = this.state === CIRCUIT_STATES.HALF_OPEN;
    const useFallback = this.state === CIRCUIT_STATES.OPEN || (recovering && this._recoveryProbe !== null);
    const providerIndex = useFallback
      ? (this.primaryIndex + 1) % this._providers.length
      : this.primaryIndex;
    if (recovering && useFallback && providerIndex === this.primaryIndex) {
      throw new Error('RPC primary recovery probe is already in progress; no fallback configured');
    }
    const probe = recovering && !useFallback ? {} : null;
    if (probe) this._recoveryProbe = probe;
    return {
      provider: this._providers[providerIndex],
      generation: this._stateGeneration,
      primary: !useFallback,
      probe,
    };
  }

  /** Only the current primary generation may change primary health. */
  _recordAttempt(attempt, successful) {
    if (!attempt?.primary || attempt.generation !== this._stateGeneration ||
        attempt.provider !== this._providers[this.primaryIndex]) return;
    if (attempt.probe && this._recoveryProbe !== attempt.probe) return;
    if (successful) this.recordSuccess();
    else this.recordFailure();
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
      let context;
      try {
        context = this._beginAttempt();
        const result = await fn(context.provider);
        this._recordAttempt(context, true);
        return result;
      } catch (err) {
        lastError = err;
        this._recordAttempt(context, false);
      } finally {
        // State changes do not release native ownership. Only actual callback
        // settlement does, and an old callback cannot clear another owner.
        if (context?.probe && this._recoveryProbe === context.probe) {
          this._recoveryProbe = null;
        }
      }

      if (attempt < maxRetries) {
        const delay = initialDelayMs * Math.pow(2, attempt) + Math.random() * 100;
        await new Promise((res) => setTimeout(res, delay));
      }
    }
    throw lastError;
  }
}

export const defaultRpcManager = new RpcProviderManager();
