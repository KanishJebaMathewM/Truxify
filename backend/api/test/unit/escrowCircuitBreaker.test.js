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
} from '../../src/services/escrowCircuitBreaker.js';

describe('escrowCircuitBreaker', () => {
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

  it('isEscrowPaused fails open when Redis is unavailable', async () => {
    redisMock.get.mockRejectedValue(new Error('down'));
    expect(await isEscrowPaused()).toBe(false);
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

  it('getPauseState defaults to not paused', async () => {
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
});
