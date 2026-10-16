/**
 * Shard credentials (#10230): the shared SHARD_PASSWORD documented in
 * .env.example covers every zone, and missing credentials only abort startup
 * when sharding is actually enabled.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const ZONE_VARS = ['SHARD_PASSWORD_NORTH', 'SHARD_PASSWORD_SOUTH', 'SHARD_PASSWORD_EAST', 'SHARD_PASSWORD_WEST'];

vi.hoisted(() => {
  // Let the module-level singleton construct; each test re-runs initializeShards().
  process.env.SHARD_PASSWORD = 'shared-at-import';
});

const { mockLogger } = vi.hoisted(() => ({
  mockLogger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      constructor(config) {
        this.config = config;
      }
      query = vi.fn();
      end = vi.fn().mockResolvedValue(undefined);
    },
  },
}));

vi.mock('../../src/config/db.js', () => ({
  redisClient: null,
  pgPool: { query: vi.fn() },
}));

const { default: shardManager } = await import('../../src/services/sharding/ShardManager.js');

describe('ShardManager shard passwords', () => {
  beforeEach(() => {
    for (const name of [...ZONE_VARS, 'SHARD_PASSWORD', 'SHARDING_ENABLED']) {
      vi.stubEnv(name, '');
    }
    mockLogger.warn.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the shared SHARD_PASSWORD for every zone', () => {
    vi.stubEnv('SHARD_PASSWORD', 'shared-secret');

    shardManager.initializeShards();

    for (const zone of ['north', 'south', 'east', 'west']) {
      expect(shardManager.shards.get(zone).password).toBe('shared-secret');
      expect(shardManager.shards.get(zone).pool.config.password).toBe('shared-secret');
    }
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('prefers a zone-specific password over the shared one', () => {
    vi.stubEnv('SHARD_PASSWORD', 'shared-secret');
    vi.stubEnv('SHARD_PASSWORD_SOUTH', 'south-secret');

    shardManager.initializeShards();

    expect(shardManager.shards.get('south').password).toBe('south-secret');
    expect(shardManager.shards.get('north').password).toBe('shared-secret');
  });

  it('does not abort startup when sharding is not enabled, but warns', () => {
    expect(() => shardManager.initializeShards()).not.toThrow();
    expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('SHARD_PASSWORD_NORTH'));
  });

  it('still fails fast on missing credentials when SHARDING_ENABLED=true', () => {
    vi.stubEnv('SHARDING_ENABLED', 'true');

    expect(() => shardManager.initializeShards()).toThrow(
      'Missing required shard password env vars: SHARD_PASSWORD_NORTH, SHARD_PASSWORD_SOUTH, SHARD_PASSWORD_EAST, SHARD_PASSWORD_WEST'
    );
  });
});
