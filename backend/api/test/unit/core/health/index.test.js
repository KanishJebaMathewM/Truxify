import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks – prevent any real external service calls
// ---------------------------------------------------------------------------

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

const mockSupabaseHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/supabaseHealth.js', () => ({ default: mockSupabaseHealth }));
const mockMongodbHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/mongodbHealth.js', () => ({ default: mockMongodbHealth }));
const mockPostgresHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/postgresHealth.js', () => ({ default: mockPostgresHealth }));
const mockRedisHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/redisHealth.js', () => ({ default: mockRedisHealth }));
const mockFirebaseHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/firebaseHealth.js', () => ({ default: mockFirebaseHealth }));
const mockPolygonHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/polygonHealth.js', () => ({ default: mockPolygonHealth }));
const mockEscrowHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/escrowHealth.js', () => ({ default: mockEscrowHealth }));
const mockKafkaHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/kafkaHealth.js', () => ({ default: mockKafkaHealth }));
const mockGraphqlHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/graphqlHealth.js', () => ({ default: mockGraphqlHealth }));
const mockWebsocketHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/websocketHealth.js', () => ({ default: mockWebsocketHealth }));
const mockMlHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/mlHealth.js', () => ({ default: mockMlHealth }));
const mockWorkerHealth = vi.fn();
vi.mock('../../../../src/core/health/checks/workerHealth.js', () => ({ default: mockWorkerHealth }));

const { createDefaultAggregator, HealthAggregator, HealthStatus, executeCheck, withTimeout } =
  await import('../../../../src/core/health/index.js');

const ALL_CHECK_NAMES = [
  'escrow', 'firebase', 'graphql', 'kafka', 'ml_engine',
  'mongodb', 'polygon', 'postgres', 'redis', 'supabase',
  'websocket', 'workers',
].sort();

const CRITICAL_CHECKS = ['supabase', 'mongodb', 'postgres'];

const mocksByName = {
  supabase: mockSupabaseHealth, mongodb: mockMongodbHealth, postgres: mockPostgresHealth,
  redis: mockRedisHealth, firebase: mockFirebaseHealth, polygon: mockPolygonHealth,
  escrow: mockEscrowHealth, kafka: mockKafkaHealth, graphql: mockGraphqlHealth,
  websocket: mockWebsocketHealth, ml_engine: mockMlHealth, workers: mockWorkerHealth,
};

function resetAllToHealthy() {
  for (const [name, mock] of Object.entries(mocksByName)) {
    mock.mockReturnValue({
      name,
      status: HealthStatus.HEALTHY,
      critical: CRITICAL_CHECKS.includes(name),
      responseTime: 5,
      timestamp: new Date().toISOString(),
    });
  }
}

describe('core/health/index.js — createDefaultAggregator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetAllToHealthy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('health-check registration', () => {
    it('returns a HealthAggregator instance', () => {
      expect(createDefaultAggregator()).toBeInstanceOf(HealthAggregator);
    });

    it('registers exactly 12 health checks with expected names', () => {
      const aggregator = createDefaultAggregator();
      expect(aggregator._checks).toHaveLength(12);
      expect(aggregator._checks.map(c => c.name).sort()).toEqual(ALL_CHECK_NAMES);
    });

    it('sets critical flags correctly (supabase, mongodb, postgres)', () => {
      const aggregator = createDefaultAggregator();
      const critical = aggregator._checks.filter(c => c.critical).map(c => c.name).sort();
      const nonCritical = aggregator._checks.filter(c => !c.critical).map(c => c.name).sort();
      
      expect(critical).toEqual(['mongodb', 'postgres', 'supabase']);
      expect(nonCritical).toHaveLength(9);
    });
  });

  describe('aggregated health response and status calculation', () => {
    it('returns HEALTHY overall and proper shape when all checks report healthy', async () => {
      const aggregator = createDefaultAggregator();
      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.summary.total).toBe(12);
      expect(result.summary.healthy).toBe(12);
      expect(Object.keys(result.services)).toHaveLength(12);
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('version');
    });

    it('returns UNHEALTHY when any critical check fails', async () => {
      mockSupabaseHealth.mockReturnValue({
        name: 'supabase', status: HealthStatus.UNHEALTHY,
        message: 'down', critical: true, responseTime: 50, timestamp: new Date().toISOString(),
      });

      const aggregator = createDefaultAggregator();
      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.services.supabase.status).toBe(HealthStatus.UNHEALTHY);
    });

    it('returns DEGRADED when non-critical checks fail but critical checks are healthy', async () => {
      mockRedisHealth.mockReturnValue({
        name: 'redis', status: HealthStatus.UNHEALTHY,
        message: 'down', critical: false, responseTime: 50, timestamp: new Date().toISOString(),
      });
      mockFirebaseHealth.mockReturnValue({
        name: 'firebase', status: HealthStatus.DEGRADED,
        message: 'slow', critical: false, responseTime: 50, timestamp: new Date().toISOString(),
      });

      const aggregator = createDefaultAggregator();
      const result = await aggregator.aggregate();

      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.summary.unhealthy).toBe(1);
      expect(result.summary.degraded).toBe(1);
    });
  });

  describe('module re-exports', () => {
    it('re-exports health primitives correctly', () => {
      expect(HealthAggregator).toBeDefined();
      expect(HealthStatus.HEALTHY).toBe('healthy');
      expect(typeof executeCheck).toBe('function');
      expect(typeof withTimeout).toBe('function');
    });
  });
});
