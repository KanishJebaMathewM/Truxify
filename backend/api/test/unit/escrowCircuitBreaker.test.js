import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

describe('escrowCircuitBreaker', () => {
  let mockRedis;
  let isEscrowPaused;
  let setEscrowPaused;
  let getPauseState;
  let escrowPausedResult;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockRedis = {
      get: vi.fn(),
      set: vi.fn(),
      del: vi.fn(),
    };
    vi.doMock('../../src/config/db.js', () => ({
      redisClient: mockRedis,
    }));
    const mod = await import('../../src/services/escrowCircuitBreaker.js');
    isEscrowPaused = mod.isEscrowPaused;
    setEscrowPaused = mod.setEscrowPaused;
    getPauseState = mod.getPauseState;
    escrowPausedResult = mod.escrowPausedResult;
  });

  describe('isEscrowPaused', () => {
    it('returns false when redisClient is null', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const mod = await import('../../src/services/escrowCircuitBreaker.js');
      const result = await mod.isEscrowPaused();
      expect(result).toBe(false);
    });

    it('returns false when pause key is not set', async () => {
      mockRedis.get.mockResolvedValue(null);
      const result = await isEscrowPaused();
      expect(result).toBe(false);
    });

    it('returns true when pause key is "1"', async () => {
      mockRedis.get.mockResolvedValue('1');
      const result = await isEscrowPaused();
      expect(result).toBe(true);
    });

    it('returns false (fail-open) when Redis get throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis connection refused'));
      const result = await isEscrowPaused();
      expect(result).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledOnce();
    });
  });

  describe('setEscrowPaused', () => {
    it('opens the circuit and persists the pause flag', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(0);

      const result = await setEscrowPaused(true);

      expect(result.paused).toBe(true);
      expect(result.persisted).toBe(true);
      expect(result).toHaveProperty('updatedAt');
      expect(mockRedis.set).toHaveBeenCalledWith('escrow:circuit-breaker:paused', '1');
      expect(mockLogger.warn).toHaveBeenCalledOnce();
    });

    it('closes the circuit and removes the pause flag', async () => {
      mockRedis.set.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1);

      const result = await setEscrowPaused(false);

      expect(result.paused).toBe(false);
      expect(result.persisted).toBe(true);
      expect(mockRedis.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused');
      expect(mockRedis.del).toHaveBeenCalledWith('escrow:circuit-breaker:paused-at');
      expect(mockLogger.info).toHaveBeenCalledOnce();
    });

    it('throws when Redis set throws', async () => {
      mockRedis.set.mockRejectedValue(new Error('Redis write failed'));

      await expect(setEscrowPaused(true)).rejects.toThrow();
    });
  });

  describe('getPauseState', () => {
    it('returns not paused when Redis is null', async () => {
      vi.doMock('../../src/config/db.js', () => ({ redisClient: null }));
      const mod = await import('../../src/services/escrowCircuitBreaker.js');
      const result = await mod.getPauseState();
      expect(result.paused).toBe(false);
      expect(result.pausedAt).toBeNull();
    });

    it('returns paused state from Redis', async () => {
      mockRedis.get.mockResolvedValueOnce('1');
      mockRedis.get.mockResolvedValueOnce('2026-01-01T00:00:00.000Z');

      const result = await getPauseState();

      expect(result.paused).toBe(true);
      expect(result.pausedAt).toBe('2026-01-01T00:00:00.000Z');
    });

    it('returns not paused when Redis get throws', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis unavailable'));

      const result = await getPauseState();

      expect(result.paused).toBe(false);
      expect(mockLogger.error).toHaveBeenCalledOnce();
    });
  });

  describe('escrowPausedResult', () => {
    it('returns correct result shape with bookingId', () => {
      const result = escrowPausedResult('BOOKING-123');
      expect(result.bookingId).toBe('BOOKING-123');
      expect(result.code).toBe('ESCROW_PAUSED');
      expect(result.error).toBe('Escrow is paused by the circuit breaker.');
    });

    it('merges extra fields into result', () => {
      const result = escrowPausedResult('BOOKING-456', { driverId: 'driver-1' });
      expect(result.bookingId).toBe('BOOKING-456');
      expect(result.driverId).toBe('driver-1');
      expect(result.code).toBe('ESCROW_PAUSED');
    });
  });
});
