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

    it('routes Delhi to the north shard', () => {
      const shard = ShardManager.getShardForLocation(28.6139, 77.2090);
      expect(shard).toBe('north');
    });

    it('routes Patna (Bihar) to the east shard (issue #11394)', () => {
      const shard = ShardManager.getShardForLocation(25.6, 85.1);
      expect(shard).toBe('east');
    });

    it('routes Kerala to the south shard', () => {
      const shard = ShardManager.getShardForLocation(10.5, 76.5);
      expect(shard).toBe('south');
    });

    it('routes Andhra to the south shard', () => {
      const shard = ShardManager.getShardForLocation(16.0, 80.0);
      expect(shard).toBe('south');
    });

    it('routes Goa to the west shard', () => {
      const shard = ShardManager.getShardForLocation(15.3, 74.1);
      expect(shard).toBe('west');
    });

    it('routes Odisha to the east shard', () => {
      const shard = ShardManager.getShardForLocation(20.5, 85.5);
      expect(shard).toBe('east');
    });

    it('returns a configured shard for every resolved state (no default misuse)', () => {
      const state = ShardManager.getStateFromCoordinates(25.6, 85.1);
      expect(['north', 'south', 'east', 'west']).toContain(ShardManager.getShardForState(state));
    });
  });

  describe('getShardConnection', () => {
    it('returns a database connection for a shard', async () => {
      const conn = await ShardManager.getShardConnection('north');
      expect(conn).toBeDefined();
    });
  });

  describe('getOrderLocation', () => {
    it('does not throw on a corrupt cached location and falls back (issue #12031)', async () => {
      // A corrupt (non-JSON) cache value must not propagate a parse error;
      // the manager must fall back to the authoritative/default location so
      // the request succeeds instead of 500-ing.
      ShardManager.redis.get = vi.fn().mockResolvedValue('%%%not-valid-json%%%');
      const loc = await ShardManager.getOrderLocation('order-corrupt-12031');
      expect(loc).toBeDefined();
      expect(typeof loc.state).toBe('string');
    });
  });
});
