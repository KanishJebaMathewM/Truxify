import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { z } from 'zod';

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (_req, _res, next) => next(),
}));

vi.mock('../../src/middleware/validate.js', () => ({
  validateQuery: () => (req, _res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (_req, _res, next) => next(),
}));

const { dbMock, svcMock } = vi.hoisted(() => ({
  dbMock: { supabaseAdmin: { from: vi.fn() } },
  svcMock: { auditLogService: { query: vi.fn() } },
}));

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return dbMock.supabaseAdmin; },
  get supabase() { return null; },
}));

vi.mock('../../src/services/auditLogService.js', () => svcMock);

vi.mock('../../src/middleware/logger.js', () => ({
  default: { error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

import auditRoutes from '../../src/routes/auditRoutes.js';

function makeApp() {
  const app = express();
  app.use('/audit', auditRoutes);
  return app;
}

describe('auditRoutes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    svcMock.auditLogService.query.mockResolvedValue({ data: [], pagination: { total: 0 } });
  });

  describe('GET /audit/', () => {
    it('returns query results on success', async () => {
      svcMock.auditLogService.query.mockResolvedValue({ data: [{ id: 'a1' }], pagination: { total: 1 } });
      const res = await request(makeApp()).get('/audit/');
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{ id: 'a1' }]);
    });

    it('returns 500 when the service errors', async () => {
      svcMock.auditLogService.query.mockRejectedValue(new Error('db down'));
      const res = await request(makeApp()).get('/audit/');
      expect(res.status).toBe(500);
      expect(res.body.error).toBe('Failed to fetch audit logs.');
    });
  });

  describe('GET /audit/:id', () => {
    it('returns 404 when the entry is not found', async () => {
      dbMock.supabaseAdmin.from.mockReturnValue({
        select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })),
      });
      const res = await request(makeApp()).get('/audit/nonexistent-id');
      expect(res.status).toBe(404);
      expect(res.body.error).toBe('Audit log entry not found.');
    });

    it('returns 503 when supabaseAdmin is not available', async () => {
      dbMock.supabaseAdmin = null;
      const res = await request(makeApp()).get('/audit/any-id');
      expect(res.status).toBe(503);
      dbMock.supabaseAdmin = { from: vi.fn() };
    });
  });
});
