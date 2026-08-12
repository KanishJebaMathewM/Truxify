import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

function mockRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  };
}

describe('escrowCircuitBreaker', () => {
  let redis;
  let circuitBreaker;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    redis = mockRedis();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: redis,
    }));
    circuitBreaker = await import('../../src/services/escrowCircuitBreaker.js');
  });

  it('reports not paused when no Redis client exists', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: null,
    }));
    const mod = await import('../../src/services/escrowCircuitBreaker.js');
    expect(await mod.isEscrowPaused()).toBe(false);
    const state = await mod.getPauseState();
    expect(state).toEqual({ paused: false, pausedAt: null });
  });

  it('isEscrowPaused returns true when the pause key is "1"', async () => {
    redis.get.mockResolvedValue('1');
    expect(await circuitBreaker.isEscrowPaused()).toBe(true);
  });

  it('isEscrowPaused returns false when the pause key is absent', async () => {
    redis.get.mockResolvedValue(null);
    expect(await circuitBreaker.isEscrowPaused()).toBe(false);
  });

  it('fails open when the Redis read throws', async () => {
    redis.get.mockRejectedValue(new Error('redis down'));
    expect(await circuitBreaker.isEscrowPaused()).toBe(false);
  });

  it('setEscrowPaused(true) writes the pause keys', async () => {
    const result = await circuitBreaker.setEscrowPaused(true);
    expect(result.paused).toBe(true);
    expect(result.persisted).toBe(true);
    expect(redis.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused', '1');
    expect(redis.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at', expect.any(String));
  });

  it('setEscrowPaused(false) deletes the pause keys', async () => {
    await circuitBreaker.setEscrowPaused(false);
    expect(redis.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
    expect(redis.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at');
  });

  it('getPauseState reads both keys', async () => {
    redis.get
      .mockResolvedValueOnce('1')
      .mockResolvedValueOnce('2026-08-11T00:00:00.000Z');
    const state = await circuitBreaker.getPauseState();
    expect(state).toEqual({
      paused: true,
      pausedAt: '2026-08-11T00:00:00.000Z',
    });
  });

  it('escrowPausedResult returns the expected envelope', () => {
    const result = circuitBreaker.escrowPausedResult('booking-1', { amount: 100 });
    expect(result).toEqual({
      amount: 100,
      bookingId: 'booking-1',
      error: 'Escrow is paused by the circuit breaker.',
      code: 'ESCROW_PAUSED',
    });
  });
});
