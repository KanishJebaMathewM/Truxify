import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockSupabase = {};
vi.mock('../../../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  supabase: mockSupabase,
  supabaseAdmin: mockSupabase,
  firebaseAdmin: mockSupabase,
  get firebaseAdmin() { return mockSupabase; },
}));

vi.mock('../../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../../src/core/performanceMetrics.js', () => ({
  measureExecution: (_name, fn) => fn(),
}));

// Mock all health check modules
vi.mock('../../../../src/core/health/checks/supabaseHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'supabase',
    status: 'healthy',
    critical: true,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/mongodbHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'mongodb',
    status: 'healthy',
    critical: true,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/postgresHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'postgres',
    status: 'healthy',
    critical: true,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/redisHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'redis',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/firebaseHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'firebase',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/polygonHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'polygon',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/escrowHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'escrow',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/kafkaHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'kafka',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/graphqlHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'graphql',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/websocketHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'websocket',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/mlHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'ml_engine',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

vi.mock('../../../../src/core/health/checks/workerHealth.js', () => ({
  default: vi.fn(() => ({
    name: 'workers',
    status: 'healthy',
    critical: false,
    responseTime: 5,
    timestamp: new Date().toISOString(),
  })),
}));

describe('health/index.js — createDefaultAggregator', () => {
  let createDefaultAggregator;
  let HealthAggregator;

  beforeEach(async () => {
    vi.resetModules();
    const module = await import('../../../../src/core/health/index.js');
    createDefaultAggregator = module.createDefaultAggregator;
    HealthAggregator = module.HealthAggregator;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a HealthAggregator instance', async () => {
    const aggregator = createDefaultAggregator();
    expect(aggregator).toBeInstanceOf(HealthAggregator);
  });

  it('registers all expected health checks', async () => {
    const aggregator = createDefaultAggregator();
    // Trigger aggregate to run all checks
    const result = await aggregator.aggregate();
    const registeredNames = Object.keys(result.services).sort();

    const expected = [
      'escrow',
      'firebase',
      'graphql',
      'kafka',
      'ml_engine',
      'mongodb',
      'polygon',
      'postgres',
      'redis',
      'supabase',
      'websocket',
      'workers',
    ].sort();

    expect(registeredNames).toEqual(expected);
  });

  it('supabase is marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.supabase.critical).toBe(true);
  });

  it('mongodb is marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.mongodb.critical).toBe(true);
  });

  it('postgres is marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.postgres.critical).toBe(true);
  });

  it('redis is NOT marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.redis.critical).toBe(false);
  });

  it('firebase is NOT marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.firebase.critical).toBe(false);
  });

  it('polygon is NOT marked as critical', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.services.polygon.critical).toBe(false);
  });

  it('all checks are present in the services map', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    const count = Object.keys(result.services).length;
    expect(count).toBe(12);
  });

  it('summary.total reflects all registered checks', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    expect(result.summary.total).toBe(12);
  });

  it('each service result includes required fields', async () => {
    const aggregator = createDefaultAggregator();
    const result = await aggregator.aggregate();
    const supabase = result.services.supabase;
    expect(supabase).toHaveProperty('name');
    expect(supabase).toHaveProperty('status');
    expect(supabase).toHaveProperty('responseTime');
    expect(supabase).toHaveProperty('critical');
    expect(supabase).toHaveProperty('timestamp');
  });
});
