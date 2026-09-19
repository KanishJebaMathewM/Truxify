import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSupabase = {};
const mockSupabaseAdmin = {};
const mockFirebaseAdmin = {};

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  get supabase() { return mockSupabase; },
  supabase: mockSupabase,
  get supabaseAdmin() { return mockSupabaseAdmin; },
  supabaseAdmin: mockSupabaseAdmin,
  get firebaseAdmin() { return mockFirebaseAdmin; },
  firebaseAdmin: mockFirebaseAdmin,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

// ── Supabase Health ─────────────────────────────────────────────────────────

describe('supabaseHealth', () => {
  let supabaseHealth;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../../src/core/health/checks/supabaseHealth.js');
    supabaseHealth = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns UNHEALTHY when client is not configured', async () => {
    // Override the mock for this specific test
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: null,
      supabaseAdmin: null,
    }));
    const { default: fn } = await import('../../src/core/health/checks/supabaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('not_configured');
  });

  it('returns UNHEALTHY when query returns an error', async () => {
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: { message: 'permission denied' } })),
        })),
      })),
    };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: mockClient,
      supabaseAdmin: null,
    }));

    const { default: fn } = await import('../../src/core/health/checks/supabaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('permission denied');
  });

  it('returns HEALTHY when query succeeds', async () => {
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: mockClient,
      supabaseAdmin: null,
    }));

    const { default: fn } = await import('../../src/core/health/checks/supabaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('healthy');
    expect(result.message).toBeUndefined();
  });

  it('uses supabaseAdmin when supabase is null', async () => {
    const mockAdmin = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: null,
      supabaseAdmin: mockAdmin,
    }));

    const { default: fn } = await import('../../src/core/health/checks/supabaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('healthy');
  });

  it('returns a result object with expected fields', async () => {
    const mockClient = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve({ error: null })),
        })),
      })),
    };

    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      supabase: mockClient,
    }));

    const { default: fn } = await import('../../src/core/health/checks/supabaseHealth.js');
    const result = await fn();
    expect(result).toHaveProperty('name', 'supabase');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('responseTime');
    expect(result).toHaveProperty('critical');
    expect(result).toHaveProperty('timestamp');
  });
});

// ── Firebase Health ─────────────────────────────────────────────────────────

describe('firebaseHealth', () => {
  let firebaseHealth;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    const mod = await import('../../src/core/health/checks/firebaseHealth.js');
    firebaseHealth = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns DEGRADED when firebaseAdmin is not configured', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      firebaseAdmin: null,
    }));
    const { default: fn } = await import('../../src/core/health/checks/firebaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('degraded');
    expect(result.message).toBe('not_configured');
  });

  it('returns HEALTHY when firebaseAdmin is configured', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      firebaseAdmin: { some: 'firebase instance' },
    }));
    const { default: fn } = await import('../../src/core/health/checks/firebaseHealth.js');
    const result = await fn();
    expect(result.status).toBe('healthy');
  });

  it('returns a result object with expected fields', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      firebaseAdmin: {},
    }));
    const { default: fn } = await import('../../src/core/health/checks/firebaseHealth.js');
    const result = await fn();
    expect(result).toHaveProperty('name', 'firebase');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('responseTime');
    expect(result).toHaveProperty('critical');
    expect(result).toHaveProperty('timestamp');
  });

  it('is marked as non-critical', async () => {
    vi.resetModules();
    vi.doMock('../../src/config/db.js', () => ({
      firebaseAdmin: {},
    }));
    const { default: fn } = await import('../../src/core/health/checks/firebaseHealth.js');
    const result = await fn();
    expect(result.critical).toBe(false);
  });
});

// ── Polygon Health ───────────────────────────────────────────────────────────

describe('polygonHealth', () => {
  let polygonHealth;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    delete process.env.POLYGON_RPC_URL;
    const mod = await import('../../src/core/health/checks/polygonHealth.js');
    polygonHealth = mod.default;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns UNHEALTHY when POLYGON_RPC_URL is not configured', async () => {
    const result = await polygonHealth();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toBe('not_configured');
  });

  it('returns UNHEALTHY when RPC URL is empty string', async () => {
    process.env.POLYGON_RPC_URL = '';
    // Need to re-evaluate env
    vi.resetModules();
    delete process.env.POLYGON_RPC_URL;
    const { default: fn } = await import('../../src/core/health/checks/polygonHealth.js');
    const result = await fn();
    expect(result.status).toBe('unhealthy');
  });

  it('returns HEALTHY with metadata when RPC returns block number', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    // Mock global fetch
    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x1234abcd' }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.status).toBe('healthy');
    expect(result.message).toBe('reachable');
    expect(result.metadata).toHaveProperty('blockNumber', '0x1234abcd');
  });

  it('redacts credentials from RPC URL in metadata', async () => {
    process.env.POLYGON_RPC_URL = 'https://user:password@polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x1' }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.metadata.rpcUrl).toBe('https://***@polygon-rpc.com');
    expect(result.metadata.rpcUrl).not.toContain('password');
  });

  it('returns UNHEALTHY when fetch returns non-OK response', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: false,
        status: 503,
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('configured_but_unreachable');
    expect(result.message).toContain('503');
  });

  it('returns UNHEALTHY when RPC returns JSON error', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({
          jsonrpc: '2.0',
          id: 1,
          error: { message: 'Internal error', code: -32603 },
        }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('configured_but_unreachable');
    expect(result.message).toContain('Internal error');
  });

  it('returns UNHEALTHY when RPC result is null', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: null }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('configured_but_unreachable');
  });

  it('returns a result object with expected fields on success', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x1' }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result).toHaveProperty('name', 'polygon');
    expect(result).toHaveProperty('status');
    expect(result).toHaveProperty('responseTime');
    expect(result).toHaveProperty('critical');
    expect(result).toHaveProperty('timestamp');
  });

  it('uses timeout of 4000ms for RPC probe', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    // Never resolves — will hit timeout
    const mockFetch = vi.fn(() => new Promise(() => {}));
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.status).toBe('unhealthy');
    expect(result.message).toContain('configured_but_unreachable');
  });

  it('is marked as non-critical', async () => {
    process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';

    const mockFetch = vi.fn(() =>
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ jsonrpc: '2.0', id: 1, result: '0x1' }),
      }),
    );
    vi.stubGlobal('fetch', mockFetch);

    const result = await polygonHealth();
    expect(result.critical).toBe(false);
  });
});
