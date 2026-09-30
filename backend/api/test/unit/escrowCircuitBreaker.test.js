import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

const { redisMock } = vi.hoisted(() => ({
  redisMock: { get: vi.fn(), set: vi.fn(), del: vi.fn() },
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: redisMock,
}));

import {
  isEscrowPaused,
  setEscrowPaused,
  getPauseState,
  escrowPausedResult,
  escrowBreaker,
  CircuitBreaker,
  CircuitState,
} from '../../src/services/escrowCircuitBreaker.js';

describe('escrowCircuitBreaker Unit Tests', () => {
  beforeEach(() => {
    escrowBreaker.reset();
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
  });

  describe('Redis-backed Emergency Pause State', () => {
    it('isEscrowPaused returns true when the pause flag is set in Redis', async () => {
      redisMock.get.mockResolvedValue('1');
      expect(await isEscrowPaused()).toBe(true);
      expect(redisMock.get).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
    });

    it('isEscrowPaused returns false when the flag is absent or not set to "1"', async () => {
      redisMock.get.mockResolvedValue(null);
      expect(await isEscrowPaused()).toBe(false);

  it('isEscrowPaused fails closed when a Redis read throws (outage = paused)', async () => {
    redisMock.get.mockRejectedValue(new Error('down'));
    expect(await isEscrowPaused()).toBe(true);
  });

  // Uses a scoped re-mock (vi.doMock + fresh module graph) so redisClient can be
  // null without disturbing the shared redisMock used by the rest of this file.
  it('isEscrowPaused fails closed when no Redis client is configured', async () => {
    vi.resetModules();
    vi.doMock('../../src/middleware/logger.js', () => ({
      default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
    }));
    vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
    try {
      const { isEscrowPaused: isEscrowPausedWithoutClient } = await import(
        '../../src/services/escrowCircuitBreaker.js'
      );
      expect(await isEscrowPausedWithoutClient()).toBe(true);
    } finally {
      vi.doUnmock('../../src/config/db.js');
      vi.doUnmock('../../src/middleware/logger.js');
      vi.resetModules();
    }
  });

  it('setEscrowPaused(true) opens the circuit and persists a timestamp', async () => {
    const before = Date.now();
    const result = await setEscrowPaused(true);
    expect(result.paused).toBe(true);
    expect(result.persisted).toBe(true);
    expect(new Date(result.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(redisMock.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused', '1');
    expect(redisMock.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at', result.updatedAt);
  });

    it('setEscrowPaused(true) opens the circuit and persists pause flag and timestamp', async () => {
      const before = Date.now();
      const result = await setEscrowPaused(true);
      expect(result.paused).toBe(true);
      expect(result.persisted).toBe(true);
      expect(new Date(result.updatedAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(redisMock.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused', '1');
      expect(redisMock.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at', result.updatedAt);
    });

    it('setEscrowPaused(false) closes the circuit and deletes Redis keys', async () => {
      const result = await setEscrowPaused(false);
      expect(result.paused).toBe(false);
      expect(result.persisted).toBe(true);
      expect(redisMock.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
      expect(redisMock.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at');
    });

    it('setEscrowPaused throws when Redis write operation fails', async () => {
      redisMock.set.mockRejectedValue(new Error('Redis write failed'));
      await expect(setEscrowPaused(true)).rejects.toThrow('Redis write failed');
    });

  it('getPauseState reports an unknown Redis state as paused', async () => {
    const state = await getPauseState();
    expect(state).toEqual({ paused: false, pausedAt: null });
  });

    it('getPauseState returns paused: false and pausedAt: null when no flag is set', async () => {
      const state = await getPauseState();
      expect(state).toEqual({ paused: false, pausedAt: null });
    });

    it('getPauseState fails open and returns default unpaused state on Redis read error', async () => {
      redisMock.get.mockRejectedValue(new Error('Redis read failure'));
      const state = await getPauseState();
      expect(state).toEqual({ paused: false, pausedAt: null });
    });

    it('escrowPausedResult shapes standardized error payload for escrow service rejections', () => {
      expect(escrowPausedResult('booking-101')).toEqual({
        bookingId: 'booking-101',
        error: 'Escrow is paused by the circuit breaker.',
        code: 'ESCROW_PAUSED',
      });
      expect(escrowPausedResult('booking-102', { transactionId: 'tx-999', retryable: false })).toEqual({
        bookingId: 'booking-102',
        transactionId: 'tx-999',
        retryable: false,
        error: 'Escrow is paused by the circuit breaker.',
        code: 'ESCROW_PAUSED',
      });
    });
  });

  describe('CircuitBreaker State Transitions & State Machine', () => {
    it('initial state is CLOSED with zero failures and successes', () => {
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.state).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.failureCount).toBe(0);
      expect(escrowBreaker.successCount).toBe(0);
    });

    it('reaches failure threshold (3) and transitions from CLOSED to OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Contract call failed'));

      // Failure 1
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.failureCount).toBe(1);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      // Failure 2
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.failureCount).toBe(2);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      // Failure 3 -> opens circuit
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.failureCount).toBe(3);
      expect(escrowBreaker.getState()).toBe(CircuitState.OPEN);
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);

      // Subsequent call fast-fails without executing the wrapped function
      const successFn = vi.fn().mockResolvedValue('tx-hash');
      await expect(escrowBreaker.execute(successFn)).rejects.toThrow('CircuitBreaker:escrow is OPEN');
      expect(successFn).not.toHaveBeenCalled();
    });

    it('transitions from OPEN to HALF_OPEN after reset timeout expires on next attempt check', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('RPC node unavailable'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);

      // Simulate time advancing past nextAttempt
      escrowBreaker.nextAttempt = Date.now() - 100;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);
      expect(escrowBreaker.state).toBe(CircuitState.HALF_OPEN);
    });

    it('HALF_OPEN allows a single probe and short-circuits concurrent probe requests', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Error'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Start in-flight probe
      let resolveProbe;
      const probeFn = vi.fn(() => new Promise((resolve) => { resolveProbe = resolve; }));
      const probePromise = escrowBreaker.execute(probeFn);

      // Second probe attempt during in-flight probe should be rejected immediately
      const concurrentFn = vi.fn().mockResolvedValue('concurrent_result');
      await expect(escrowBreaker.execute(concurrentFn)).rejects.toThrow(
        'CircuitBreaker:escrow is HALF_OPEN (probe in flight)'
      );
      expect(concurrentFn).not.toHaveBeenCalled();

      // Complete the in-flight probe successfully
      resolveProbe('probe_success');
      const probeResult = await probePromise;
      expect(probeResult).toBe('probe_success');
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('successful execution in HALF_OPEN recovers and resets state to CLOSED', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Failure'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      const successfulProbe = vi.fn().mockResolvedValue({ txHash: '0xabc123' });
      const result = await escrowBreaker.execute(successfulProbe);

      expect(result).toEqual({ txHash: '0xabc123' });
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.failureCount).toBe(0);
    });

    it('failure during HALF_OPEN probe immediately trips circuit back to OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Primary failure'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      const failedProbe = vi.fn().mockRejectedValue(new Error('Probe failed'));
      await expect(escrowBreaker.execute(failedProbe)).rejects.toThrow('Probe failed');
      expect(escrowBreaker.getState()).toBe(CircuitState.OPEN);
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);
    });

    it('successful execution in CLOSED state resets consecutive failure count', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Transient network glitch'));
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Transient network glitch');
      expect(escrowBreaker.failureCount).toBe(1);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      const successFn = vi.fn().mockResolvedValue('success');
      const res = await escrowBreaker.execute(successFn);
      expect(res).toBe('success');
      expect(escrowBreaker.failureCount).toBe(0);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('transitions to HALF_OPEN via scheduled timer after resetTimeoutMs', async () => {
      vi.useFakeTimers();
      try {
        const failingFn = vi.fn().mockRejectedValue(new Error('fail'));
        for (let i = 0; i < 3; i++) {
          await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
        }
        expect(escrowBreaker.state).toBe(CircuitState.OPEN);

        // Advance timers by resetTimeoutMs (10,000ms)
        vi.advanceTimersByTime(10000);
        expect(escrowBreaker.state).toBe(CircuitState.HALF_OPEN);
      } finally {
        vi.useRealTimers();
      }
    });

    it('enforces requestTimeoutMs and trips failure on timeout', async () => {
      vi.useFakeTimers();
      try {
        const slowFn = () => new Promise((resolve) => setTimeout(resolve, 6000));
        const execPromise = escrowBreaker.execute(slowFn);
        const rejectionAssertion = expect(execPromise).rejects.toThrow(
          /Request timed out after 5000ms/
        );
        vi.advanceTimersByTime(5001);
        await rejectionAssertion;
        expect(escrowBreaker.failureCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('throws TypeError when non-function is passed to execute()', async () => {
      await expect(escrowBreaker.execute(null)).rejects.toThrow(TypeError);
      await expect(escrowBreaker.execute('not-a-fn')).rejects.toThrow(TypeError);
      await expect(escrowBreaker.execute(123)).rejects.toThrow(TypeError);
    });

    it('reset() and destroy() clear timers and restore CLOSED state', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);

      escrowBreaker.destroy();
      expect(escrowBreaker.state).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.failureCount).toBe(0);
      expect(escrowBreaker.successCount).toBe(0);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('executes fallback handler when circuit is OPEN or probe fails if fallback is provided', async () => {
      const fallbackFn = vi.fn((param) => `fallback-${param}`);
      const customBreaker = new CircuitBreaker('custom-escrow', {
        failureThreshold: 2,
        resetTimeoutMs: 5000,
        fallback: fallbackFn,
      });

      const failingFn = vi.fn().mockRejectedValue(new Error('Service down'));

      // First failure returns fallback result
      const res1 = await customBreaker.execute(failingFn, 'attempt-1');
      expect(res1).toBe('fallback-attempt-1');
      expect(customBreaker.failureCount).toBe(1);

      // Second failure trips circuit to OPEN and returns fallback result
      const res2 = await customBreaker.execute(failingFn, 'attempt-2');
      expect(res2).toBe('fallback-attempt-2');
      expect(customBreaker.getState()).toBe(CircuitState.OPEN);

      // In OPEN state, fallback is invoked without calling wrapped function
      const successFn = vi.fn().mockResolvedValue('ok');
      const res3 = await customBreaker.execute(successFn, 'attempt-3');
      expect(res3).toBe('fallback-attempt-3');
      expect(successFn).not.toHaveBeenCalled();

      customBreaker.destroy();
    });
  });
});


