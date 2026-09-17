import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.SHARD_PASSWORD_NORTH = 'mock';
  process.env.SHARD_PASSWORD_SOUTH = 'mock';
  process.env.SHARD_PASSWORD_EAST = 'mock';
  process.env.SHARD_PASSWORD_WEST = 'mock';
});

const { mockPgQuery } = vi.hoisted(() => ({
  mockPgQuery: vi.fn(),
}));

vi.mock('pg', () => ({
  default: {
    Pool: class MockPool {
      connect = vi.fn();
      query = vi.fn();
      end = vi.fn().mockResolvedValue(undefined);
    },
  },
}));

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  redisClient: {
    get: vi.fn(),
  },
  pgPool: {
    query: mockPgQuery,
  },
}));

describe('ShardManager', () => {
  let ShardManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    mockPgQuery.mockReset();
    vi.resetModules();

    ShardManager = (
      await import('../../src/services/sharding/ShardManager.js')
    ).default;
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

      expect(['north', 'south', 'east', 'west']).toContain(
        ShardManager.getShardForState(state),
      );
    });
  });

  describe('getShardConnection', () => {
    it('returns a database connection for a shard', async () => {
      const conn = await ShardManager.getShardConnection('north');

      expect(conn).toBeDefined();
    });

    it('falls back to the north shard when requested shard is unavailable', async () => {
      const northPool = ShardManager.shards.get('north').pool;

      ShardManager.shards.get('south').pool = null;

      const conn = await ShardManager.getShardConnection('south');

      expect(conn).toBe(northPool);
    });

    it('throws when requested shard and north fallback are unavailable', async () => {
      ShardManager.shards.get('south').pool = null;
      ShardManager.shards.get('north').pool = null;

      await expect(
        ShardManager.getShardConnection('south'),
      ).rejects.toThrow(
        'No database shard available (requested: south, north fallback also unavailable)',
      );
    });
  });

  describe('getOrderLocation', () => {
    it('does not throw on a corrupt cached location and falls back (issue #12031)', async () => {
      // A corrupt (non-JSON) cache value must not propagate a parse error.
      // The manager must fall back to the authoritative/default location.
      ShardManager.redis.get = vi
        .fn()
        .mockResolvedValue('%%%not-valid-json%%%');

      const loc = await ShardManager.getOrderLocation(
        'order-corrupt-12031',
      );

      expect(loc).toBeDefined();
      expect(typeof loc.state).toBe('string');
    });
  });

  describe('getStateFromCoordinates', () => {
    it('uses the default state for invalid coordinates', () => {
      expect(
        ShardManager.getStateFromCoordinates('28.6', 77.2),
      ).toBe('delhi');

      expect(
        ShardManager.getStateFromCoordinates(28.6, '77.2'),
      ).toBe('delhi');

      expect(
        ShardManager.getStateFromCoordinates(NaN, 77.2),
      ).toBe('delhi');
    });

    it('resolves Mumbai coordinates to Maharashtra', () => {
      expect(
        ShardManager.getStateFromCoordinates(19.0760, 72.8777),
      ).toBe('maharashtra');
    });

    it('resolves Chennai coordinates to Tamil Nadu', () => {
      expect(
        ShardManager.getStateFromCoordinates(13.0827, 80.2707),
      ).toBe('tamilnadu');
    });
  });

  describe('getOrderLocation database fallback', () => {
    it('returns pickup coordinates from the database when cache misses', async () => {
      ShardManager.redis.get = vi.fn().mockResolvedValue(null);

      mockPgQuery.mockResolvedValue({
        rows: [
          {
            pickup_lat: '28.6139',
            pickup_lng: '77.2090',
          },
        ],
      });

      const location = await ShardManager.getOrderLocation('order-db');

      expect(location).toEqual({
        lat: 28.6139,
        lng: 77.209,
      });

      expect(mockPgQuery).toHaveBeenCalledWith(
        'SELECT pickup_lat, pickup_lng FROM orders WHERE id = $1 LIMIT 1',
        ['order-db'],
      );
    });

    it('falls back to the default state when database lookup returns no location', async () => {
      ShardManager.redis.get = vi.fn().mockResolvedValue(null);

      mockPgQuery.mockResolvedValue({
        rows: [],
      });

      const location =
        await ShardManager.getOrderLocation('unknown-order');

      expect(location.lat).toBeNull();
      expect(location.lng).toBeNull();
      expect(location.state).toBe('delhi');
    });

    it('falls back when the database lookup fails', async () => {
      ShardManager.redis.get = vi.fn().mockResolvedValue(null);

      mockPgQuery.mockRejectedValue(
        new Error('database unavailable'),
      );

      const location =
        await ShardManager.getOrderLocation('order-error');

      expect(location).toEqual({
        lat: null,
        lng: null,
        state: 'delhi',
      });
    });
  });

  describe('executeQuery', () => {
    it('executes a query on the requested shard', async () => {
      const northPool = ShardManager.shards.get('north').pool;

      northPool.query.mockResolvedValue({
        rows: [{ id: 1 }],
      });

      const result = await ShardManager.executeQuery(
        'SELECT * FROM orders WHERE id = $1',
        [1],
        'north',
      );

      expect(result).toEqual([{ id: 1 }]);

      expect(northPool.query).toHaveBeenCalledWith(
        'SELECT * FROM orders WHERE id = $1',
        [1],
      );
    });

    it('propagates query errors', async () => {
      const northPool = ShardManager.shards.get('north').pool;

      northPool.query.mockRejectedValue(
        new Error('query failed'),
      );

      await expect(
        ShardManager.executeQuery('SELECT 1', []),
      ).rejects.toThrow('query failed');
    });
  });

  describe('executeCrossShardQuery', () => {
    it('executes the query across all initialized shards and returns healthy breakdown', async () => {
      for (const [, shard] of ShardManager.shards) {
        shard.pool.query.mockResolvedValue({
          rows: [{ result: 1 }],
        });
      }

      const response = await ShardManager.executeCrossShardQuery({
        query: 'SELECT 1',
        params: [],
      });

      expect(response.results).toHaveLength(4);
      expect(response.failed).toEqual([]);
      expect(response.healthy).toEqual([
        'north',
        'south',
        'east',
        'west',
      ]);
      expect(response.unhealthy).toEqual([]);
      expect(response.partial).toBe(false);
      expect(response.results.map((result) => result.shard)).toEqual([
        'north',
        'south',
        'east',
        'west',
      ]);
      expect(response.results[0].data).toEqual([{ result: 1 }]);
    });

    it('captures failed shards and returns partial: true when a shard query rejects', async () => {
      for (const [name, shard] of ShardManager.shards) {
        if (name === 'east') {
          shard.pool.query.mockRejectedValue(new Error('East shard connection timeout'));
        } else {
          shard.pool.query.mockResolvedValue({
            rows: [{ result: 1 }],
          });
        }
      }

      const response = await ShardManager.executeCrossShardQuery({
        query: 'SELECT 1',
        params: [],
      });

      expect(response.results).toHaveLength(3);
      expect(response.failed).toEqual(['east']);
      expect(response.healthy).toEqual(['north', 'south', 'west']);
      expect(response.unhealthy).toEqual(['east']);
      expect(response.partial).toBe(true);
    });

    it('captures uninitialized shard pools in failed list', async () => {
      ShardManager.shards.get('west').pool = null;

      for (const [name, shard] of ShardManager.shards) {
        if (shard.pool) {
          shard.pool.query.mockResolvedValue({
            rows: [{ result: 1 }],
          });
        }
      }

      const response = await ShardManager.executeCrossShardQuery({
        query: 'SELECT 1',
        params: [],
      });

      expect(response.results).toHaveLength(3);
      expect(response.failed).toEqual(['west']);
      expect(response.partial).toBe(true);
    });
  });

  describe('healthCheck', () => {
    it('reports all initialized shards as healthy', async () => {
      for (const [, shard] of ShardManager.shards) {
        shard.pool.query.mockResolvedValue({
          rows: [{ '?column?': 1 }],
        });
      }

      const status = await ShardManager.healthCheck();

      expect(status).toEqual({
        north: 'healthy',
        south: 'healthy',
        east: 'healthy',
        west: 'healthy',
      });
    });

    it('reports a shard as unhealthy when its query fails', async () => {
      const northPool = ShardManager.shards.get('north').pool;

      northPool.query.mockRejectedValue(
        new Error('connection failed'),
      );

      const status = await ShardManager.healthCheck();

      expect(status.north).toBe('unhealthy');
      expect(status.south).toBe('healthy');
      expect(status.east).toBe('healthy');
      expect(status.west).toBe('healthy');
    });
  });

  describe('closeAllConnections', () => {
    it('closes all shard connections', async () => {
      await ShardManager.closeAllConnections();

      for (const [, shard] of ShardManager.shards) {
        expect(shard.pool.end).toHaveBeenCalledTimes(1);
      }
    });

    it('does not close connections again after already being closed', async () => {
      await ShardManager.closeAllConnections();
      await ShardManager.closeAllConnections();

      for (const [, shard] of ShardManager.shards) {
        expect(shard.pool.end).toHaveBeenCalledTimes(1);
      }
    });
  });
});