import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const { dbMock } = vi.hoisted(() => ({
  dbMock: {
    supabase: { from: vi.fn() },
    redisClient: null,
  },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabase() { return dbMock.supabase; },
  get redisClient() { return dbMock.redisClient; },
}));

async function makeApp() {
  vi.resetModules();
  const { default: lookupRoutes } = await import('../../src/routes/lookupRoutes.js');
  const app = express();
  app.use('/lookup', lookupRoutes);
  return app;
}

describe('lookupRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.redisClient = null;
  });

  describe('GET /lookup/vehicle-types', () => {
    it('returns vehicle types on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'Truck' }], error: null }),
      });
      const res = await request(await makeApp()).get('/lookup/vehicle-types');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 1, name: 'Truck' }]);
    });

    it('returns 500 when the query errors', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'db down' } }),
      });
      const res = await request(await makeApp()).get('/lookup/vehicle-types');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch vehicle types');
    });
  });

  describe('GET /lookup/regions', () => {
    it('returns regions on success', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'North' }], error: null }),
      });
      const res = await request(await makeApp()).get('/lookup/regions');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 1, name: 'North' }]);
    });

    it('returns 500 when the query errors', async () => {
      dbMock.supabase.from.mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: null, error: { message: 'boom' } }),
      });
      const res = await request(await makeApp()).get('/lookup/regions');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch regions');
    });
  });
});
