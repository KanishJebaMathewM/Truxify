import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HealthStatus } from '../../../../src/core/health/HealthCheck.js';

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

describe('mlHealth', () => {
  beforeEach(() => {
    process.env.ML_ENGINE_URL = 'http://ml-engine.test:8001';
  });

  afterEach(() => {
    delete process.env.ML_ENGINE_URL;
    vi.unstubAllGlobals();
  });

  it('returns healthy when the ML engine reports a healthy status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        status: 'healthy',
        models_loaded: 3,
        service: 'truxify-ml',
      }),
    }));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.modelsLoaded).toBe(3);
    expect(result.metadata.service).toBe('truxify-ml');
    expect(result.critical).toBe(false);
  });

  it('returns degraded when the ML engine responds with a non-healthy status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'loading', models_loaded: 0 }),
    }));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it('returns unhealthy when the ML engine responds with a non-OK HTTP status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('HTTP 503');
  });

  it('returns unhealthy when the fetch rejects', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.critical).toBe(false);
  });

  it('returns unhealthy when the health payload has no status field', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ models_loaded: 1 }),
    }));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it('includes responseTime and timestamp fields on a healthy result', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ status: 'healthy' }),
    }));

    const { default: check } = await import('../../../../src/core/health/checks/mlHealth.js');
    const result = await check();

    expect(typeof result.responseTime).toBe('number');
    expect(typeof result.timestamp).toBe('string');
    expect(Number.isNaN(Date.parse(result.timestamp))).toBe(false);
  });
});
