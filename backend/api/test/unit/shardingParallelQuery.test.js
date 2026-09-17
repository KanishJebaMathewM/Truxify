import { describe, it, expect, vi, beforeEach } from 'vitest';

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

    const results = await ShardManager.executeCrossShardQuery({ query: 'SELECT * FROM test' });

    const activeShardsCount = Array.from(ShardManager.shards.values()).filter(s => s.pool).length;
    expect(mockQuery).toHaveBeenCalledTimes(activeShardsCount);

    expect(results).toHaveLength(activeShardsCount);
    expect(results[0]).toHaveProperty('shard');
    expect(results[0]).toHaveProperty('data');
    expect(results[0].data).toEqual([{ id: 1, val: 'foo' }]);
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
});
