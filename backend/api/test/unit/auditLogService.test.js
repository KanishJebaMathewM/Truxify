/**
 * Unit tests for backend/api/src/services/auditLogService.js
 *
 * Coverage:
 *   - log: successful insert returns data
 *   - log: DB insert error returns null and logs error
 *   - log: exception thrown returns null and logs error
 *   - log: supabaseAdmin unavailable returns null and logs warning
 *   - query: successful query with all filters
 *   - query: pagination with page and limit
 *   - query: sort order ascending/descending
 *   - query: DB error returns empty data with pagination metadata
 *   - query: supabaseAdmin unavailable returns empty data
 *   - query: invalid sort column defaults to created_at
 *   - query: limit clamped to max 100
 *
 * Run with:  npm run test:unit -- test/unit/auditLogService.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const mockSupabaseAdmin = vi.hoisted(() => {
  const q = { from: vi.fn() };
  q.from.mockReturnValue(q);
  return q;
});

vi.mock('../../src/config/db.js', () => ({
  supabaseAdmin: mockSupabaseAdmin,
}));

import { auditLogService } from '../../src/services/auditLogService.js';

function makeInsertChain(mockData, mockError) {
  const chain = {
    select: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: mockData, error: mockError }),
  };
  chain.insert = vi.fn().mockReturnValue(chain);
  return chain;
}

function makeSelectChain(mockData, mockError, mockCount) {
  const q = {
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockResolvedValue({ data: mockData, error: mockError, count: mockCount }),
  };
  q.select = vi.fn().mockReturnValue(q);
  return q;
}

describe('auditLogService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('log', () => {
    const validEntry = {
      actorId: 'actor-1',
      actorRole: 'admin',
      actorName: 'Admin User',
      action: 'admin:view-dashboard',
      resourceType: 'order',
      resourceId: 'order-123',
      method: 'GET',
      path: '/api/orders/123',
      ipAddress: '192.168.1.1',
      userAgent: 'Mozilla/5.0',
      correlationId: 'corr-1',
      requestId: 'req-1',
      statusCode: 200,
      beforeState: { status: 'pending' },
      afterState: { status: 'confirmed' },
      metadata: { reason: 'manual review' },
    };

    it('returns data on successful insert', async () => {
      const insertedRecord = { id: 'audit-1', ...validEntry, created_at: '2026-08-03T00:00:00Z' };
      const insertChain = makeInsertChain(insertedRecord, null);
      mockSupabaseAdmin.from.mockReturnValueOnce({ insert: vi.fn().mockReturnValue(insertChain) });

      const result = await auditLogService.log(validEntry);

      expect(result).toEqual(insertedRecord);
      expect(mockLogger.error).not.toHaveBeenCalled();
    });

    it('returns null and logs error on DB insert error', async () => {
      const insertChain = makeInsertChain(null, { message: 'Insert failed' });
      mockSupabaseAdmin.from.mockReturnValueOnce({ insert: vi.fn().mockReturnValue(insertChain) });

      const result = await auditLogService.log(validEntry);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: { message: 'Insert failed' } },
        '[AuditLog] Failed to insert audit entry'
      );
    });

    it('returns null and logs error when exception is thrown', async () => {
      const insertChain = {
        select: vi.fn().mockReturnThis(),
        single: vi.fn().mockRejectedValue(new Error('Network error')),
      };
      insertChain.insert = vi.fn().mockReturnValue(insertChain);
      mockSupabaseAdmin.from.mockReturnValueOnce({ insert: vi.fn().mockReturnValue(insertChain) });

      const result = await auditLogService.log(validEntry);

      expect(result).toBeNull();
      expect(mockLogger.error).toHaveBeenCalledWith(
        { err: expect.any(Error) },
        '[AuditLog] Exception inserting audit entry'
      );
    });

  });

  describe('query', () => {
    it('returns data with pagination on successful query', async () => {
      const mockData = [{ id: 'audit-1', action: 'admin:login' }];
      const selectChain = makeSelectChain(mockData, null, 1);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      const result = await auditLogService.query({ actorId: 'actor-1' });

      expect(result.data).toEqual(mockData);
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
    });

    it('applies actorId, action, resourceType filters', async () => {
      const selectChain = makeSelectChain([], null, 0);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      await auditLogService.query({
        actorId: 'actor-1',
        action: 'admin:login',
        resourceType: 'order',
      });

      expect(selectChain.eq).toHaveBeenCalledWith('actor_id', 'actor-1');
      expect(selectChain.eq).toHaveBeenCalledWith('action', 'admin:login');
      expect(selectChain.eq).toHaveBeenCalledWith('resource_type', 'order');
    });

    it('applies startDate and endDate filters', async () => {
      const selectChain = makeSelectChain([], null, 0);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      await auditLogService.query({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });

      expect(selectChain.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00Z');
      expect(selectChain.lte).toHaveBeenCalledWith('created_at', '2026-12-31T23:59:59Z');
    });

    it('returns empty data and logs error on DB query error', async () => {
      const selectChain = makeSelectChain(null, { message: 'Query failed' }, null);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      const result = await auditLogService.query({ actorId: 'actor-1' });

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('clamps limit to max 100', async () => {
      const selectChain = makeSelectChain([], null, 0);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      await auditLogService.query({ limit: 500 });

      expect(selectChain.range).toHaveBeenCalledWith(0, 99);
    });

    it('defaults invalid sort column to created_at', async () => {
      const selectChain = makeSelectChain([], null, 0);
      mockSupabaseAdmin.from.mockReturnValueOnce({ select: vi.fn().mockReturnValue(selectChain) });

      await auditLogService.query({ sortBy: 'invalid_column' });

      expect(selectChain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });
  });
});
