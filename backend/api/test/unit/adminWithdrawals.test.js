import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const adminDbMock = {
  from: vi.fn(),
  rpc: vi.fn(),
};

vi.mock('../../src/config/db.js', () => ({
  
  redisClient: global.mockRedis,
  upstashRedisClient: global.mockRedis,
  supabaseAdmin: adminDbMock,
  supabase: adminDbMock,
}));

vi.mock('../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => {
    req.user = { id: 'admin-1', role: 'admin' };
    next();
  },
}));

vi.mock('../../src/middleware/requirePolicy.js', () => ({
  requirePolicy: () => (req, res, next) => next(),
}));

vi.mock('../../src/middleware/rateLimiter.js', () => ({
  userLimiter: (req, res, next) => next(),
}));

vi.mock('../../src/middleware/auditLog.js', () => ({
  auditLog: () => (req, res, next) => next(),
}));

const adminRoutes = (await import('../../src/routes/adminRoutes.js')).default;

describe('Admin Stuck Withdrawals & DLQ Endpoints', () => {
  let app;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    app.use('/api/v1/admin', adminRoutes);
  });

  describe('GET /api/v1/admin/withdrawals/stuck', () => {
    it('returns stuck and DLQ withdrawals with pagination', async () => {
      const mockRows = [
        {
          id: 'w-dlq-1',
          driver_id: 'd-1',
          amount: 5000,
          status: 'settlement_failed',
          retry_count: 5,
          dlq_reason: 'Exceeded max retries',
        },
      ];

      const queryBuilder = {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        or: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({ data: mockRows, error: null, count: 1 }),
      };

      adminDbMock.from.mockReturnValue(queryBuilder);

      const res = await request(app).get('/api/v1/admin/withdrawals/stuck?limit=10&offset=0');

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.withdrawals).toHaveLength(1);
      expect(res.body.withdrawals[0].id).toBe('w-dlq-1');
    });
  });

  describe('POST /api/v1/admin/withdrawals/:id/retry', () => {
    it('calls admin_resolve_dlq_withdrawal with action retry', async () => {
      adminDbMock.rpc.mockResolvedValue({
        data: { success: true, action: 'retried', status: 'pending' },
        error: null,
      });

      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w-test-1/retry')
        .send({ notes: 'Manual operator retry' });

      expect(res.status).toBe(200);
      expect(adminDbMock.rpc).toHaveBeenCalledWith('admin_resolve_dlq_withdrawal', {
        p_withdrawal_id: 'w-test-1',
        p_action: 'retry',
        p_admin_id: 'admin-1',
        p_notes: 'Manual operator retry',
      });
      expect(res.body.success).toBe(true);
    });
  });

  describe('POST /api/v1/admin/withdrawals/:id/refund', () => {
    it('calls admin_resolve_dlq_withdrawal with action refund', async () => {
      adminDbMock.rpc.mockResolvedValue({
        data: { success: true, action: 'refunded', status: 'failed' },
        error: null,
      });

      const res = await request(app)
        .post('/api/v1/admin/withdrawals/w-test-2/refund')
        .send({ notes: 'Gateway confirmed payout never executed; refunding' });

      expect(res.status).toBe(200);
      expect(adminDbMock.rpc).toHaveBeenCalledWith('admin_resolve_dlq_withdrawal', {
        p_withdrawal_id: 'w-test-2',
        p_action: 'refund',
        p_admin_id: 'admin-1',
        p_notes: 'Gateway confirmed payout never executed; refunding',
      });
      expect(res.body.success).toBe(true);
    });
  });
});
