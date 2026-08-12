import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import { HealthStatus, withTimeout, executeCheck } from '../../../src/core/health/HealthCheck.js';

describe('HealthCheck utilities', () => {
  describe('HealthStatus constants', () => {
    it('defines all four status values', () => {
      expect(HealthStatus.HEALTHY).toBe('healthy');
      expect(HealthStatus.DEGRADED).toBe('degraded');
      expect(HealthStatus.UNHEALTHY).toBe('unhealthy');
      expect(HealthStatus.UNKNOWN).toBe('unknown');
    });
  });

  describe('withTimeout', () => {
    it('resolves with the promise value when it completes before timeout', async () => {
      const result = await withTimeout(Promise.resolve('ok'), 1000);
      expect(result).toBe('ok');
    });

    it('rejects with timeout error when promise exceeds timeout', async () => {
      const slow = new Promise((resolve) => setTimeout(() => resolve('late'), 200));
      await expect(withTimeout(slow, 50)).rejects.toThrow('healthcheck timeout');
    });

    it('cleans up timer on success', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      await withTimeout(Promise.resolve('ok'), 1000);
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });

    it('cleans up timer on rejection', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout');
      const slow = new Promise((_, reject) => setTimeout(() => reject(new Error('fail')), 200));
      await expect(withTimeout(slow, 50)).rejects.toThrow();
      expect(clearTimeoutSpy).toHaveBeenCalled();
      clearTimeoutSpy.mockRestore();
    });
  });

  describe('executeCheck', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('returns HEALTHY status with response time on success', async () => {
      const checkFn = vi.fn().mockResolvedValue({ status: HealthStatus.HEALTHY });
      const result = await executeCheck('test-service', checkFn);

      expect(result.name).toBe('test-service');
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.responseTime).toBeGreaterThanOrEqual(0);
      expect(result.critical).toBe(false);
      expect(result.timestamp).toBeDefined();
    });

    it('returns HEALTHY when check returns undefined (no explicit status)', async () => {
      const checkFn = vi.fn().mockResolvedValue(undefined);
      const result = await executeCheck('test-service', checkFn);
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('propagates metadata and message from check function', async () => {
      const checkFn = vi.fn().mockResolvedValue({
        status: HealthStatus.HEALTHY,
        message: 'all good',
        metadata: { pool: 5 },
      });
      const result = await executeCheck('test-service', checkFn);

      expect(result.message).toBe('all good');
      expect(result.metadata).toEqual({ pool: 5 });
    });

    it('returns UNHEALTHY when check throws', async () => {
      const checkFn = vi.fn().mockRejectedValue(new Error('connection refused'));
      const result = await executeCheck('test-service', checkFn);

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('connection refused');
    });

    it('returns UNHEALTHY with timeout message on timeout', async () => {
      vi.useRealTimers();
      const checkFn = vi.fn().mockImplementation(() => new Promise((r) => setTimeout(r, 5000)));
      const result = await executeCheck('test-service', checkFn, { timeoutMs: 50 });

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toContain('timeout');
      vi.useFakeTimers();
    });

    it('respects critical flag', async () => {
      const checkFn = vi.fn().mockResolvedValue({ status: HealthStatus.HEALTHY });
      const result = await executeCheck('test-service', checkFn, { critical: true });

      expect(result.critical).toBe(true);
    });

    it('defaults critical to false', async () => {
      const checkFn = vi.fn().mockResolvedValue({ status: HealthStatus.HEALTHY });
      const result = await executeCheck('test-service', checkFn);

      expect(result.critical).toBe(false);
    });

    it('includes timestamp in ISO format', async () => {
      const checkFn = vi.fn().mockResolvedValue({ status: HealthStatus.HEALTHY });
      const result = await executeCheck('test-service', checkFn);

      expect(new Date(result.timestamp).toISOString()).toBe(result.timestamp);
    });
  });
});
