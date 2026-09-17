import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
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
  CircuitState,
} from '../../src/services/escrowCircuitBreaker.js';

describe('escrowCircuitBreaker', () => {
  beforeEach(() => {
    escrowBreaker.reset();
  });
  beforeEach(() => {
    vi.clearAllMocks();
    redisMock.get.mockResolvedValue(null);
    redisMock.set.mockResolvedValue('OK');
    redisMock.del.mockResolvedValue(1);
  });

  it('isEscrowPaused is true when the flag is set in Redis', async () => {
    redisMock.get.mockResolvedValue('1');
    expect(await isEscrowPaused()).toBe(true);
    expect(redisMock.get).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
  });

  it('isEscrowPaused is false when the flag is absent', async () => {
    expect(await isEscrowPaused()).toBe(false);
  });

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

  it('setEscrowPaused(false) closes the circuit and clears state', async () => {
    const result = await setEscrowPaused(false);
    expect(result.paused).toBe(false);
    expect(redisMock.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
    expect(redisMock.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at');
  });

  it('setEscrowPaused reports not persisted when Redis is unavailable', async () => {
    redisMock.set.mockRejectedValue(new Error('down'));
    await expect(setEscrowPaused(true)).rejects.toThrow('down');
  });

  it('getPauseState reports the flag and the time it was set', async () => {
    redisMock.get.mockImplementation((key) =>
      key === 'escrow:circuit-breaker:paused'
        ? Promise.resolve('1')
        : Promise.resolve('2026-08-11T00:00:00.000Z'),
    );
    const state = await getPauseState();
    expect(state).toEqual({ paused: true, pausedAt: '2026-08-11T00:00:00.000Z' });
  });

  it('getPauseState reports an unknown Redis state as paused', async () => {
    const state = await getPauseState();
    expect(state).toEqual({ paused: false, pausedAt: null });
  });

  it('escrowPausedResult shapes the rejection returned by escrow submission paths', () => {
    expect(escrowPausedResult('bk-1')).toEqual({
      bookingId: 'bk-1',
      error: 'Escrow is paused by the circuit breaker.',
      code: 'ESCROW_PAUSED',
    });
    expect(escrowPausedResult('bk-1', { txData: null })).toMatchObject({
      bookingId: 'bk-1',
      txData: null,
      code: 'ESCROW_PAUSED',
    });
  });

  describe('escrowBreaker state machine transitions', () => {
    it('initial state is CLOSED', () => {
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.state).toBe(CircuitState.CLOSED);
    });

    it('failure threshold opens circuit', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Contract call failed'));

      // Threshold is 3
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('Contract call failed');
      expect(escrowBreaker.getState()).toBe(CircuitState.OPEN);

      // Subsequent call fast-fails without executing function
      const successFn = vi.fn().mockResolvedValue('ok');
      await expect(escrowBreaker.execute(successFn)).rejects.toThrow('CircuitBreaker:escrow is OPEN');
      expect(successFn).not.toHaveBeenCalled();
    });

    it('timeout returns circuit to half-open', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Network error'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);

      // Advance time past resetTimeoutMs (10000ms)
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);
    });

    it('half-open allows one test request and rejects concurrent probe', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Fail'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      // Start an in-flight probe
      let resolveProbe;
      const probeFn = () => new Promise((resolve) => { resolveProbe = resolve; });
      const probePromise = escrowBreaker.execute(probeFn);

      // Second probe attempt in HALF_OPEN should be rejected immediately
      const extraFn = vi.fn().mockResolvedValue('extra');
      await expect(escrowBreaker.execute(extraFn)).rejects.toThrow('CircuitBreaker:escrow is HALF_OPEN (probe in flight)');
      expect(extraFn).not.toHaveBeenCalled();

      // Resolve probe
      resolveProbe('probe_success');
      const result = await probePromise;
      expect(result).toBe('probe_success');
    });

    it('success in half-open closes circuit', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Failure'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      const successfulProbe = vi.fn().mockResolvedValue({ txHash: '0x123' });
      const result = await escrowBreaker.execute(successfulProbe);

      expect(result).toEqual({ txHash: '0x123' });
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.failureCount).toBe(0);
    });

    it('failure in half-open immediately returns to OPEN', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('Initial failure'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      escrowBreaker.nextAttempt = Date.now() - 1;
      expect(escrowBreaker.getState()).toBe(CircuitState.HALF_OPEN);

      const failedProbe = vi.fn().mockRejectedValue(new Error('Probe failed'));
      await expect(escrowBreaker.execute(failedProbe)).rejects.toThrow('Probe failed');
      expect(escrowBreaker.getState()).toBe(CircuitState.OPEN);
    });

    it('success in CLOSED state resets failure count', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('transient error'));
      await expect(escrowBreaker.execute(failingFn)).rejects.toThrow('transient error');
      expect(escrowBreaker.failureCount).toBe(1);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);

      const successFn = vi.fn().mockResolvedValue('ok');
      const res = await escrowBreaker.execute(successFn);
      expect(res).toBe('ok');
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

        // Fast forward timer
        vi.advanceTimersByTime(10000);
        expect(escrowBreaker.state).toBe(CircuitState.HALF_OPEN);
      } finally {
        vi.useRealTimers();
      }
    });

    it('handles request timeout and increments failure count', async () => {
      vi.useFakeTimers();
      try {
        const slowFn = () => new Promise((resolve) => setTimeout(resolve, 6000));
        const execPromise = escrowBreaker.execute(slowFn);
        const rejectionAssertion = expect(execPromise).rejects.toThrow(/Request timed out after 5000ms/);
        vi.advanceTimersByTime(5001);
        await rejectionAssertion;
        expect(escrowBreaker.failureCount).toBe(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it('reset() manually transitions circuit breaker back to CLOSED', async () => {
      const failingFn = vi.fn().mockRejectedValue(new Error('fail'));
      for (let i = 0; i < 3; i++) {
        await expect(escrowBreaker.execute(failingFn)).rejects.toThrow();
      }
      expect(escrowBreaker.state).toBe(CircuitState.OPEN);

      escrowBreaker.reset();
      expect(escrowBreaker.state).toBe(CircuitState.CLOSED);
      expect(escrowBreaker.failureCount).toBe(0);
      expect(escrowBreaker.getState()).toBe(CircuitState.CLOSED);
    });
  });
});

