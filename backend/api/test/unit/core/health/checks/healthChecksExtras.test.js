import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { HealthStatus } = await import('../../../../../src/core/health/HealthCheck.js');

async function loadHealthChecks(db) {
  vi.resetModules();
  vi.doMock('../../../../../src/config/db.js', () => db);
  const supabaseHealth = (await import('../../../../../src/core/health/checks/supabaseHealth.js')).default;
  const workerHealth = (await import('../../../../../src/core/health/checks/workerHealth.js')).default;
  const polygonHealth = (await import('../../../../../src/core/health/checks/polygonHealth.js')).default;
  const kafkaHealth = (await import('../../../../../src/core/health/checks/kafkaHealth.js')).default;
  const graphqlHealth = (await import('../../../../../src/core/health/checks/graphqlHealth.js')).default;
  return { supabaseHealth, workerHealth, polygonHealth, kafkaHealth, graphqlHealth };
}

const originalFetch = globalThis.fetch;

describe('supabaseHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
  });

  it('reports unhealthy when no supabase client is configured', async () => {
    const { supabaseHealth } = await loadHealthChecks({ supabase: null, supabaseAdmin: null });
    const result = await supabaseHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('not_configured');
  });

  it('reports healthy on a successful probe', async () => {
    const supabaseAdmin = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ error: null }) })) })),
    };
    const { supabaseHealth } = await loadHealthChecks({ supabase: null, supabaseAdmin });
    const result = await supabaseHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });

  it('reports unhealthy when the probe errors', async () => {
    const supabaseAdmin = {
      from: vi.fn(() => ({ select: vi.fn(() => ({ limit: vi.fn().mockResolvedValue({ error: { message: 'db down' } }) })) })),
    };
    const { supabaseHealth } = await loadHealthChecks({ supabase: null, supabaseAdmin });
    const result = await supabaseHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
  });
});

describe('workerHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete globalThis.__truxify_workers;
  });

  it('reports unhealthy when no workers are registered', async () => {
    const { workerHealth } = await loadHealthChecks({});
    const result = await workerHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('no_registered_workers');
  });

  it('reports healthy when all workers are running', async () => {
    globalThis.__truxify_workers = { sweeper: true, relay: true };
    const { workerHealth } = await loadHealthChecks({});
    const result = await workerHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.workerCount).toBe(2);
  });

  it('reports degraded when a worker is not running', async () => {
    globalThis.__truxify_workers = { sweeper: true, relay: false };
    const { workerHealth } = await loadHealthChecks({});
    const result = await workerHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });
});

describe('polygonHealth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports unhealthy when RPC URL is not configured', async () => {
    const { polygonHealth } = await loadHealthChecks({});
    const result = await polygonHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toBe('not_configured');
  });

  it('reports healthy with the block number on success', async () => {
    process.env.POLYGON_RPC_URL = 'https://rpc.example.com';
    fetchMock.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ result: '0x10' }),
    });
    const { polygonHealth } = await loadHealthChecks({});
    const result = await polygonHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
    expect(result.metadata.blockNumber).toBe('0x10');
  });

  it('reports unhealthy when the RPC returns an error', async () => {
    process.env.POLYGON_RPC_URL = 'https://rpc.example.com';
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const { polygonHealth } = await loadHealthChecks({});
    const result = await polygonHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.UNHEALTHY);
    expect(result.message).toContain('configured_but_unreachable');
  });
});

describe('kafkaHealth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
  });

  it('reports degraded when kafka is not configured', async () => {
    const { kafkaHealth } = await loadHealthChecks({});
    const result = await kafkaHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
    expect(result.message).toBe('not_configured');
  });

  it('reports degraded when the kafka config module is unavailable', async () => {
    process.env.KAFKA_ENABLED = 'true';
    const { kafkaHealth } = await loadHealthChecks({});
    const result = await kafkaHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });
});

describe('graphqlHealth', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = fetchMock;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('reports healthy when the Apollo health endpoint responds ok', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { graphqlHealth } = await loadHealthChecks({});
    const result = await graphqlHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.HEALTHY);
  });

  it('reports degraded when the endpoint returns an error status', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 503 });
    const { graphqlHealth } = await loadHealthChecks({});
    const result = await graphqlHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });

  it('reports degraded when the fetch fails', async () => {
    fetchMock.mockRejectedValue(new Error('fetch failed'));
    const { graphqlHealth } = await loadHealthChecks({});
    const result = await graphqlHealth({ timeoutMs: 100 });
    expect(result.status).toBe(HealthStatus.DEGRADED);
  });
});
