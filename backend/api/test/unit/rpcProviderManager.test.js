import { describe, it, expect, beforeEach, vi } from 'vitest';
import { RpcProviderManager, CIRCUIT_STATES } from '../../src/services/blockchain/rpcProviderManager.js';

describe('RpcProviderManager Unit Tests', () => {
  let rpcManager;

  beforeEach(() => {
    rpcManager = new RpcProviderManager({
      rpcUrls: ['https://rpc-primary.example.com', 'https://rpc-fallback.example.com'],
      failureThreshold: 2,
      cooldownMs: 500,
      requestTimeoutMs: 1000
    });
  });

  it('should initialize in CLOSED state with primary provider', () => {
    expect(rpcManager.state).toBe(CIRCUIT_STATES.CLOSED);
    const provider = rpcManager.getProvider();
    expect(provider).toBeDefined();
  });

  it('should trip to OPEN state when consecutive failures reach threshold', () => {
    rpcManager.recordFailure();
    expect(rpcManager.state).toBe(CIRCUIT_STATES.CLOSED);

    rpcManager.recordFailure();
    expect(rpcManager.state).toBe(CIRCUIT_STATES.OPEN);
  });

  it('should failover to secondary provider when circuit is OPEN', () => {
    rpcManager.recordFailure();
    rpcManager.recordFailure(); // Trips circuit to OPEN

    const fallbackProvider = rpcManager.getProvider();
    expect(fallbackProvider).toBeDefined();
  });

  it('should transition to HALF_OPEN after cooldown period', async () => {
    rpcManager.recordFailure();
    rpcManager.recordFailure();
    expect(rpcManager.state).toBe(CIRCUIT_STATES.OPEN);

    // Wait past cooldown
    await new Promise((resolve) => setTimeout(resolve, 600));

    const provider = rpcManager.getProvider();
    expect(rpcManager.state).toBe(CIRCUIT_STATES.HALF_OPEN);
    expect(provider).toBeDefined();
  });

  it('should reset to CLOSED on successful probe during HALF_OPEN', async () => {
    rpcManager.recordFailure();
    rpcManager.recordFailure();
    await new Promise((resolve) => setTimeout(resolve, 600));

    rpcManager.getProvider(); // Moves to HALF_OPEN
    expect(rpcManager.state).toBe(CIRCUIT_STATES.HALF_OPEN);

    rpcManager.recordSuccess();
    expect(rpcManager.state).toBe(CIRCUIT_STATES.CLOSED);
    expect(rpcManager.consecutiveFailures).toBe(0);
  });

  it('should execute retry loop and return result when function succeeds', async () => {
    const mockFn = vi.fn().mockResolvedValue('0xreceipt_hash');
    const result = await rpcManager.executeWithRetry(mockFn, { maxRetries: 2, initialDelayMs: 10 });

    expect(result).toBe('0xreceipt_hash');
    expect(mockFn).toHaveBeenCalledTimes(1);
    expect(rpcManager.state).toBe(CIRCUIT_STATES.CLOSED);
  });

  it('should retry on transient failures and throw error if all retries fail', async () => {
    const mockFn = vi.fn().mockRejectedValue(new Error('RPC Connection Error'));

    await expect(
      rpcManager.executeWithRetry(mockFn, { maxRetries: 2, initialDelayMs: 10 })
    ).rejects.toThrow('RPC Connection Error');

    expect(mockFn).toHaveBeenCalledTimes(3);
    expect(rpcManager.state).toBe(CIRCUIT_STATES.OPEN);
  });
});
