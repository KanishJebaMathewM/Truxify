import { describe, it, expect, vi } from 'vitest';

vi.hoisted(() => {
  process.env.SHARD_PASSWORD_NORTH = 'mock';
  process.env.SHARD_PASSWORD_SOUTH = 'mock';
  process.env.SHARD_PASSWORD_EAST = 'mock';
  process.env.SHARD_PASSWORD_WEST = 'mock';
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
