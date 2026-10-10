import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.hoisted(() => {
  process.env.SHARD_PASSWORD_NORTH = 'mock';
  process.env.SHARD_PASSWORD_SOUTH = 'mock';
  process.env.SHARD_PASSWORD_EAST = 'mock';
  process.env.SHARD_PASSWORD_WEST = 'mock';
});

vi.mock('../../src/config/db.js', () => ({
  supabase: { from: vi.fn() },
  redisClient: vi.fn(),
}));

describe('ShardManager - Parallel Cross-Shard Query Engine', () => {
  let ShardManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ShardManager = (await import('../../src/services/sharding/ShardManager.js')).default;
  });

  it('runs queries in parallel across all shards', async () => {
    const mockQuery = vi.fn().mockImplementation(() => {
      return Promise.resolve({ rows: [{ id: 1, val: 'foo' }] });
    });

    for (const [_, shard] of ShardManager.shards) {
      shard.pool = { query: mockQuery };
    }

    const response = await ShardManager.executeCrossShardQuery({ query: 'SELECT * FROM test' });

    const activeShardsCount = Array.from(ShardManager.shards.values()).filter(s => s.pool).length;
    expect(mockQuery).toHaveBeenCalledTimes(activeShardsCount);

    expect(response.results).toHaveLength(activeShardsCount);
    expect(response.results[0]).toHaveProperty('shard');
    expect(response.results[0]).toHaveProperty('data');
    expect(response.results[0].data).toEqual([{ id: 1, val: 'foo' }]);
  });

  it('flattens, sorts, and paginates combined results when mergeResults is true', async () => {
    ShardManager.shards.get('north').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 3, name: 'Alice' }, { id: 1, name: 'Charlie' }] }),
    };
    ShardManager.shards.get('south').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 2, name: 'Bob' }] }),
    };
    ShardManager.shards.get('east').pool = null;
    ShardManager.shards.get('west').pool = null;

    const mergedAsc = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM users' },
      { mergeResults: true, sortField: 'id', sortOrder: 'asc' }
    );

    expect(mergedAsc).toEqual([
      { id: 1, name: 'Charlie' },
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Alice' },
    ]);

    const mergedDesc = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM users' },
      { mergeResults: true, sortField: 'id', sortOrder: 'desc' }
    );

    expect(mergedDesc).toEqual([
      { id: 3, name: 'Alice' },
      { id: 2, name: 'Bob' },
      { id: 1, name: 'Charlie' },
    ]);

    const paginated = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM users' },
      { mergeResults: true, sortField: 'id', sortOrder: 'asc', limit: 2, offset: 1 }
    );

    expect(paginated).toEqual([
      { id: 2, name: 'Bob' },
      { id: 3, name: 'Alice' },
    ]);
  });

  it('dispatches all shard queries concurrently without sequential waiting', async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    for (const [name, shard] of ShardManager.shards) {
      shard.pool = {
        query: vi.fn().mockImplementation(async () => {
          inFlight += 1;
          if (inFlight > maxInFlight) {
            maxInFlight = inFlight;
          }
          await delay(40);
          inFlight -= 1;
          return { rows: [{ shard: name, status: 'ok' }] };
        }),
      };
    }

    const response = await ShardManager.executeCrossShardQuery({ query: 'SELECT * FROM status' });

    expect(response.results).toHaveLength(4);
    expect(response.healthy).toEqual(['north', 'south', 'east', 'west']);
    expect(response.failed).toEqual([]);
    expect(response.partial).toBe(false);

    // If executed sequentially, maxInFlight would be 1.
    // Concurrency ensures all 4 run at the same time.
    expect(maxInFlight).toBe(4);
  });

  it('preserves partial failure metadata on merged results without breaking array equality', async () => {
    ShardManager.shards.get('north').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1, name: 'NorthOrder' }] }),
    };
    ShardManager.shards.get('south').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 2, name: 'SouthOrder' }] }),
    };
    ShardManager.shards.get('east').pool = {
      query: vi.fn().mockRejectedValue(new Error('East network socket hung up')),
    };
    ShardManager.shards.get('west').pool = null;

    const merged = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM orders' },
      { mergeResults: true, sortField: 'id', sortOrder: 'asc' }
    );

    // Array equality remains untouched
    expect(merged).toEqual([
      { id: 1, name: 'NorthOrder' },
      { id: 2, name: 'SouthOrder' },
    ]);

    // Metadata is accessible directly on the returned array
    expect(merged.partial).toBe(true);
    expect(merged.healthy).toEqual(['north', 'south']);
    expect(merged.failed).toEqual(['east', 'west']);
    expect(merged.unhealthy).toEqual(['east', 'west']);
    expect(merged.errors.east).toBe('East network socket hung up');
    expect(merged.errors.west).toBe('Shard connection pool uninitialized');
  });

  it('supports structured return when options.structured is true with mergeResults', async () => {
    ShardManager.shards.get('north').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1, name: 'North' }] }),
    };
    ShardManager.shards.get('south').pool = {
      query: vi.fn().mockRejectedValue(new Error('South shard failure')),
    };
    ShardManager.shards.get('east').pool = null;
    ShardManager.shards.get('west').pool = null;

    const response = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM items' },
      { mergeResults: true, structured: true }
    );

    expect(response.data).toEqual([{ id: 1, name: 'North' }]);
    expect(response.partial).toBe(true);
    expect(response.healthy).toEqual(['north']);
    expect(response.failed).toEqual(['south', 'east', 'west']);
    expect(response.errors.south).toBe('South shard failure');
  });

  it('times out slow shards when timeoutMs is specified', async () => {
    ShardManager.shards.get('north').pool = {
      query: vi.fn().mockResolvedValue({ rows: [{ id: 1, status: 'fast' }] }),
    };
    ShardManager.shards.get('south').pool = {
      query: vi.fn().mockImplementation(() => new Promise((resolve) => setTimeout(resolve, 500))),
    };
    ShardManager.shards.get('east').pool = null;
    ShardManager.shards.get('west').pool = null;

    const response = await ShardManager.executeCrossShardQuery(
      { query: 'SELECT * FROM items' },
      { timeoutMs: 30 }
    );

    expect(response.healthy).toEqual(['north']);
    expect(response.failed).toContain('south');
    expect(response.errors.south).toContain('Query timed out on shard south');
    expect(response.partial).toBe(true);
  });

  it('accepts raw SQL string as first argument', async () => {
    const mockQuery = vi.fn().mockResolvedValue({ rows: [{ ok: 1 }] });
    for (const [_, shard] of ShardManager.shards) {
      shard.pool = { query: mockQuery };
    }

    const response = await ShardManager.executeCrossShardQuery('SELECT 1');
    expect(response.healthy).toHaveLength(4);
    expect(response.partial).toBe(false);
  });

  it('throws an error when query is missing or not a string', async () => {
    await expect(ShardManager.executeCrossShardQuery({})).rejects.toThrow(
      'Query string is required for executeCrossShardQuery'
    );
    await expect(ShardManager.executeCrossShardQuery(null)).rejects.toThrow(
      'Query string is required for executeCrossShardQuery'
    );
  });
});
