import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  redisClient: vi.fn(),
}));

describe('ShardManager', () => {
  let ShardManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ShardManager = (await import('../../src/services/sharding/ShardManager.js')).default;
  });

  describe('getShardForLocation', () => {
    it('returns a shard name for valid coordinates', () => {
      const shard = ShardManager.getShardForLocation(28.6139, 77.2090);
      expect(typeof shard).toBe('string');
      expect(shard.length).toBeGreaterThan(0);
    });

    it('returns consistent shard for same coordinates', () => {
      const shard1 = ShardManager.getShardForLocation(28.6139, 77.2090);
      const shard2 = ShardManager.getShardForLocation(28.6139, 77.2090);
      expect(shard1).toBe(shard2);
    });

    it('returns north shard for lat < 20', () => {
      const shard = ShardManager.getShardForLocation(15.0, 77.2090);
      expect(shard).toBe('north');
    });

    it('returns south shard for lat < 10', () => {
      const shard = ShardManager.getShardForLocation(5.0, 77.2090);
      expect(shard).toBe('south');
    });
  });

  describe('getShardConnection', () => {
    it('returns a database connection for a shard', async () => {
      const conn = await ShardManager.getShardConnection('north');
      expect(conn).toBeDefined();
    });
  });
});
