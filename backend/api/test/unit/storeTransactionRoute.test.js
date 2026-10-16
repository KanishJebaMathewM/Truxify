import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => {
    req.user = { id: req.headers['x-test-user'] || 'user-1' };
    next();
  },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { default: storeRouter } = await import('../../../store/routes.js');

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api', storeRouter);
  return a;
}

describe('POST /api/store/transaction', () => {
  it('applies set operations and the incrementCounter custom op to the caller\'s store', async () => {
    const server = app();

    const res = await request(server)
      .post('/api/store/transaction')
      .set('x-test-user', 'tenant-a')
      .send({
        operations: [
          { type: 'set', key: 'visits', value: 1 },
          { type: 'custom', name: 'incrementCounter', key: 'visits', amount: 2 },
        ],
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, data: { operationCount: 2 } });

    const state = await request(server)
      .get('/api/store/state?key=visits')
      .set('x-test-user', 'tenant-a');
    expect(state.body.data).toBe(3);
  });

  it('rejects an unknown custom op with a single 400 and changes nothing', async () => {
    const server = app();

    const res = await request(server)
      .post('/api/store/transaction')
      .set('x-test-user', 'tenant-b')
      .send({
        operations: [
          { type: 'set', key: 'flag', value: true },
          { type: 'custom', name: 'dropEverything' },
        ],
      });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'unknown custom op' });

    const state = await request(server)
      .get('/api/store/state?key=flag')
      .set('x-test-user', 'tenant-b');
    expect(state.body.data ?? null).toBeNull();
  });

  it('requires an operations array', async () => {
    const res = await request(app()).post('/api/store/transaction').send({});
    expect(res.status).toBe(400);
  });
});
