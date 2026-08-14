import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { HealthStatus, withTimeout, executeCheck } = await import('../../../src/core/health/HealthCheck.js');

describe('HealthStatus', () => {
  it('exports correct status constants', () => {
    expect(HealthStatus.HEALTHY).toBe('healthy');
    expect(HealthStatus.DEGRADED).toBe('degraded');
    expect(HealthStatus.UNHEALTHY).toBe('unhealthy');
    expect(HealthStatus.UNKNOWN).toBe('unknown');
  });
});

describe('withTimeout', () => {
  it('resolves when promise resolves before timeout', async () => {
    const promise = new Promise(resolve => setTimeout(() => resolve('done'), 5));
    const result = await withTimeout(promise, 1000);
    expect(result).toBe('done');
  });

  it('rejects with timeout error when exceeded', async () => {
    const promise = new Promise(resolve => setTimeout(() => resolve('done'), 500));
    await expect(withTimeout(promise, 10)).rejects.toThrow('healthcheck timeout after 10ms');
  });

  it('uses default timeout of 400ms', async () => {
    const promise = new Promise(resolve => setTimeout(() => resolve('done'), 500));
    await expect(withTimeout(promise)).rejects.toThrow('healthcheck timeout after 400ms');
  });

  it('passes through a resolved value', async () => {
    const result = await withTimeout(Promise.resolve(42), 1000);
    expect(result).toBe(42);
  });

  it('passes through a rejected value', async () => {
    await expect(withTimeout(Promise.reject(new Error('boom')), 1000)).rejects.toThrow('boom');
  });
});

describe('executeCheck', () => {
  it('returns correct status object on healthy result', async () => {
    const result = await executeCheck('testsvc', async () => ({ status: HealthStatus.HEALTHY }));
    expect(result.name).toBe('testsvc');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.responseTime).toBeGreaterThanOrEqual(0);
    expect(result.critical).toBe(false);
  });

  it('returns HEALTHY when checkFn returns null', async () => {
    const result = await executeCheck('testsvc', async () => null);
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });

  it('returns DEGRADED when checkFn returns degraded status', async () => {
    const result = await executeCheck('testsvc', async () => ({ status: HealthStatus.DEGRADED, message: 'slow' }));
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('slow');
  });

  it('returns UNHEALTHY when checkFn throws', async () => {
    const result = await executeCheck('testsvc', async () => { throw new Error('db timeout'); });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('db timeout');
  });

  it('returns UNHEALTHY when checkFn times out', async () => {
    const slowFn = () => new Promise(resolve => setTimeout(() => resolve({ status: HealthStatus.HEALTHY }), 500));
    const result = await executeCheck('slowsvc', slowFn, { timeoutMs: 10 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toMatch(/timeout/);
  });

  it('returns result.message when checkFn returns it', async () => {
    const result = await executeCheck('testsvc', async () => ({ status: HealthStatus.HEALTHY, message: 'all good' }));
    expect(result.message).toBe('all good');
  });

  it('marks critical flag from opts', async () => {
    const result = await executeCheck('critsvc', async () => ({ status: HealthStatus.HEALTHY }), { critical: true });
    expect(result.critical).toBe(true);
  });
});
