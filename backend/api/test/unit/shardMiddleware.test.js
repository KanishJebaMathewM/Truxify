import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SHARD_NORTH_PASSWORD = 'mock';
  process.env.SHARD_SOUTH_PASSWORD = 'mock';
  process.env.SHARD_EAST_PASSWORD = 'mock';
  process.env.SHARD_WEST_PASSWORD = 'mock';
});

import { shardMiddleware } from '../../src/middleware/shardMiddleware.js';

describe('shardMiddleware', () => {
  it('attaches default shard when no lat/lng supplied', async () => {
    const req = { query: {}, body: {} };
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    await shardMiddleware(req, res, next);

    expect(req.shard).toBe('north');
    expect(next).toHaveBeenCalled();
  });
});
