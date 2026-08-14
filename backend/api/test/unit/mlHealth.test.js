import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../middleware/logger.js', () => ({ default: mockLogger }));

import { HealthStatus } from '../../src/core/health/HealthCheck.js';
import mlHealth from '../../src/core/health/checks/mlHealth.js';

describe('mlHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ML_ENGINE_URL;
    global.fetch = undefined;
  });

  it('reports healthy when the ML health endpoint returns healthy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'healthy', models_loaded: true, service: 'ml' }),
    });
    process.env.ML_ENGINE_URL = 'http://ml:8001';
    const result = await mlHealth({ timeoutMs: 5000 });
    expect(result.name).toBe('ml_engine');
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.modelsLoaded).toBe(true);
  });

  it('reports degraded when the ML health endpoint returns non-healthy', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'loading', models_loaded: false, service: 'ml' }),
    });
    process.env.ML_ENGINE_URL = 'http://ml:8001';
    const result = await mlHealth({ timeoutMs: 5000 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it('reports unhealthy when the HTTP response is not ok', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
    process.env.ML_ENGINE_URL = 'http://ml:8001';
    const result = await mlHealth({ timeoutMs: 5000 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('HTTP 503');
  });

  it('reports unhealthy when fetch throws', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error('connection refused'));
    process.env.ML_ENGINE_URL = 'http://ml:8001';
    const result = await mlHealth({ timeoutMs: 5000 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});
