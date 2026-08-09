import { describe, it, expect, vi, beforeEach } from 'vitest';
import { HealthStatus } from '../../../src/core/health/HealthCheck.js';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

let mockSupabase = null;
let mockMongoDb = null;
let mockRedisClient = null;
let mockPgPool = null;
let mockFirebaseAdmin = null;

vi.mock('../../../src/config/db.js', () => ({
  get supabase() { return mockSupabase; },
  get mongoDb() { return mockMongoDb; },
  get redisClient() { return mockRedisClient; },
  get pgPool() { return mockPgPool; },
  get firebaseAdmin() { return mockFirebaseAdmin; },
}));

vi.mock('../../../src/services/escrow.js', () => ({
  checkEscrowHealth: vi.fn().mockResolvedValue({ status: 'not_configured' }),
}));

describe('Individual health checks', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabase = null;
    mockMongoDb = null;
    mockRedisClient = null;
    mockPgPool = null;
    mockFirebaseAdmin = null;
    delete process.env.POLYGON_RPC_URL;
    delete process.env.KAFKA_BROKERS;
    delete process.env.KAFKA_ENABLED;
    delete process.env.GRAPHQL_PORT;
    delete process.env.ML_ENGINE_URL;
  });

  describe('supabaseHealth', () => {
    it('returns unhealthy when not configured', async () => {
      mockSupabase = null;
      const { default: check } = await import('../../../src/core/health/checks/supabaseHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(true);
    });

    it('returns healthy when Supabase query succeeds', async () => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ error: null }),
      };
      const { default: check } = await import('../../../src/core/health/checks/supabaseHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('returns unhealthy when Supabase query returns error', async () => {
      mockSupabase = {
        from: vi.fn().mockReturnThis(),
        select: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ error: { message: 'relation not found' } }),
      };
      const { default: check } = await import('../../../src/core/health/checks/supabaseHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
    });
  });

  describe('mongodbHealth', () => {
    it('returns unhealthy when not configured', async () => {
      mockMongoDb = null;
      const { default: check } = await import('../../../src/core/health/checks/mongodbHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(true);
    });

    it('returns healthy when ping succeeds', async () => {
      mockMongoDb = { admin: () => ({ ping: vi.fn().mockResolvedValue(true) }) };
      const { default: check } = await import('../../../src/core/health/checks/mongodbHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('returns unhealthy when ping fails', async () => {
      mockMongoDb = { admin: () => ({ ping: vi.fn().mockRejectedValue(new Error('timeout')) }) };
      const { default: check } = await import('../../../src/core/health/checks/mongodbHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('timeout');
    });
  });

  describe('redisHealth', () => {
    it('returns unhealthy when not configured', async () => {
      mockRedisClient = null;
      const { default: check } = await import('../../../src/core/health/checks/redisHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.critical).toBe(false);
    });

    it('returns healthy when PONG received', async () => {
      mockRedisClient = { ping: vi.fn().mockResolvedValue('PONG') };
      const { default: check } = await import('../../../src/core/health/checks/redisHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('returns unhealthy on unexpected reply', async () => {
      mockRedisClient = { ping: vi.fn().mockResolvedValue('WRONG') };
      const { default: check } = await import('../../../src/core/health/checks/redisHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
    });
  });

  describe('postgresHealth', () => {
    it('returns unhealthy when pool not configured', async () => {
      mockPgPool = null;
      const { default: check } = await import('../../../src/core/health/checks/postgresHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(true);
    });

    it('returns healthy when query succeeds', async () => {
      mockPgPool = {
        query: vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] }),
        totalCount: 10,
        idleCount: 5,
      };
      const { default: check } = await import('../../../src/core/health/checks/postgresHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.metadata.poolTotalCount).toBe(10);
      expect(result.metadata.poolIdleCount).toBe(5);
    });

    it('returns unhealthy when query fails', async () => {
      mockPgPool = {
        query: vi.fn().mockRejectedValue(new Error('connection terminated')),
        totalCount: 0,
        idleCount: 0,
      };
      const { default: check } = await import('../../../src/core/health/checks/postgresHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
    });
  });

  describe('firebaseHealth', () => {
    it('returns degraded when not configured', async () => {
      mockFirebaseAdmin = null;
      const { default: check } = await import('../../../src/core/health/checks/firebaseHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(false);
    });

    it('returns healthy when configured', async () => {
      mockFirebaseAdmin = {};
      const { default: check } = await import('../../../src/core/health/checks/firebaseHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });
  });

  describe('polygonHealth', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('returns unhealthy when not configured', async () => {
      delete process.env.POLYGON_RPC_URL;
      const { default: check } = await import('../../../src/core/health/checks/polygonHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(false);
    });

    it('returns healthy when the RPC endpoint answers a probe', async () => {
      process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
        ok: true,
        json: vi.fn().mockResolvedValue({ jsonrpc: '2.0', id: 1, result: '0x19a3b7' }),
      }));

      const { default: check } = await import('../../../src/core/health/checks/polygonHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.metadata.rpcUrl).toBe('https://polygon-rpc.com');
      expect(result.metadata.blockNumber).toBe('0x19a3b7');
    });

    it('returns unhealthy when RPC URL is set but unreachable', async () => {
      process.env.POLYGON_RPC_URL = 'https://polygon-rpc.com';
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      const { default: check } = await import('../../../src/core/health/checks/polygonHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toMatch(/^configured_but_unreachable/);
      expect(result.critical).toBe(false);
    });
  });

  describe('kafkaHealth', () => {
    it('returns degraded when not configured', async () => {
      const { default: check } = await import('../../../src/core/health/checks/kafkaHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.message).toBe('not_configured');
      expect(result.critical).toBe(false);
    });

    it('returns degraded when env var is set but module not available', async () => {
      process.env.KAFKA_BROKERS = 'localhost:9092';
      const { default: check } = await import('../../../src/core/health/checks/kafkaHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
    });
  });

  describe('graphqlHealth', () => {
    it('returns degraded when GraphQL server not reachable', async () => {
      delete process.env.GRAPHQL_PORT;
      const { default: check } = await import('../../../src/core/health/checks/graphqlHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
      expect(result.critical).toBe(false);
    });
  });

  describe('workerHealth', () => {
    it('returns unhealthy when no workers are registered (fail closed)', async () => {
      const { default: check } = await import('../../../src/core/health/checks/workerHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.UNHEALTHY);
      expect(result.message).toBe('no_registered_workers');
      expect(result.metadata.workerCount).toBe(0);
    });

    it('returns healthy when all workers are running', async () => {
      globalThis.__truxify_workers = {
        dlqWorker: true,
        staleOrderWorker: true,
      };
      const { default: check } = await import('../../../src/core/health/checks/workerHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.metadata.workerCount).toBe(2);
      delete globalThis.__truxify_workers;
    });

    it('returns degraded when a worker is not running', async () => {
      globalThis.__truxify_workers = {
        dlqWorker: true,
        staleOrderWorker: false,
      };
      const { default: check } = await import('../../../src/core/health/checks/workerHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
      delete globalThis.__truxify_workers;
    });
  });

  describe('websocketHealth', () => {
    it('returns healthy when no ws state is set (default)', async () => {
      delete globalThis.__truxify_wsState;
      const { default: check } = await import('../../../src/core/health/checks/websocketHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
    });

    it('returns healthy when WebSocket server is active', async () => {
      globalThis.__truxify_wsState = {
        hasWebSocketServer: true,
        hasWsHeartbeatInterval: true,
        isSchedulerActive: true,
      };
      const { default: check } = await import('../../../src/core/health/checks/websocketHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.HEALTHY);
      expect(result.metadata.hasServer).toBe(true);
      delete globalThis.__truxify_wsState;
    });

    it('returns degraded when WebSocket server is not active', async () => {
      globalThis.__truxify_wsState = {
        hasWebSocketServer: false,
        hasWsHeartbeatInterval: false,
        isSchedulerActive: false,
      };
      const { default: check } = await import('../../../src/core/health/checks/websocketHealth.js');
      const result = await check();
      expect(result.status).toBe(HealthStatus.DEGRADED);
      delete globalThis.__truxify_wsState;
    });
  });
});
