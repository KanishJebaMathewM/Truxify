import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock dependencies ────────────────────────────────────────────
const mockInsert = vi.fn();
const mockSelect = vi.fn();
const mockSingle = vi.fn();
const mockEq = vi.fn();
const mockGte = vi.fn();
const mockLte = vi.fn();
const mockOrder = vi.fn();
const mockRange = vi.fn();

function resetMockChain() {
  mockInsert.mockReset();
  mockSelect.mockReset();
  mockSingle.mockReset();
  mockEq.mockReset();
  mockGte.mockReset();
  mockLte.mockReset();
  mockOrder.mockReset();
  mockRange.mockReset();

  // Build a reusable chain: from().select().eq()... .insert().select().single()
  const chainObj = {
    select: vi.fn().mockReturnThis(),
    insert: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    gte: vi.fn().mockReturnThis(),
    lte: vi.fn().mockReturnThis(),
    order: vi.fn().mockReturnThis(),
    range: vi.fn().mockReturnThis(),
    single: vi.fn().mockResolvedValue({ data: { id: 'log-1' }, error: null }),
    then: undefined, // will be set per test
  };

  return chainObj;
}

let mockSupabaseAdmin;
let chain;

vi.mock('../../src/config/db.js', () => ({
  get supabaseAdmin() { return mockSupabaseAdmin; },
  supabase: null,
  pgPool: null,
  redisClient: null,
  mongoDb: null,
  firebaseAdmin: null,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('AuditLogService', () => {
  let auditLogService;

  beforeEach(async () => {
    vi.clearAllMocks();
    chain = resetMockChain();

    mockSupabaseAdmin = {
      from: vi.fn().mockReturnValue(chain),
    };

    // Dynamic import to pick up the mocked config
    vi.resetModules();
    const mod = await import('../../src/services/auditLogService.js');
    auditLogService = mod.auditLogService;
  });

  describe('log()', () => {
    it('should insert an audit entry with all fields', async () => {
      chain.single.mockResolvedValue({
        data: { id: 'log-1', action: 'admin:view-dashboard' },
        error: null,
      });

      const result = await auditLogService.log({
        actorId: 'actor-uuid-1',
        actorRole: 'admin',
        actorName: 'Test Admin',
        action: 'admin:view-dashboard',
        resourceType: 'admin_dashboard',
        resourceId: null,
        method: 'GET',
        path: '/api/v1/admin/dashboard',
        ipAddress: '127.0.0.1',
        userAgent: 'Mozilla/5.0',
        correlationId: 'corr-123',
        requestId: 'req-456',
        statusCode: 200,
        beforeState: null,
        afterState: null,
        metadata: { duration_ms: 50 },
      });

      expect(mockSupabaseAdmin.from).toHaveBeenCalledWith('application_audit_logs');
      expect(chain.insert).toHaveBeenCalled();
      expect(result).toEqual({ id: 'log-1', action: 'admin:view-dashboard' });
    });

    it('should return null and log error when Supabase insert fails', async () => {
      chain.single.mockResolvedValue({
        data: null,
        error: { message: 'insert failed' },
      });

      const result = await auditLogService.log({
        actorId: 'actor-uuid-1',
        actorRole: 'admin',
        action: 'test:action',
        resourceType: 'test',
        method: 'GET',
        path: '/test',
      });

      expect(result).toBeNull();
    });

    it('should return null when supabaseAdmin is null', async () => {
      mockSupabaseAdmin = null;

      vi.resetModules();
      const mod = await import('../../src/services/auditLogService.js');
      const service = mod.auditLogService;

      const result = await service.log({
        actorId: 'actor-uuid-1',
        actorRole: 'admin',
        action: 'test:action',
        resourceType: 'test',
        method: 'GET',
        path: '/test',
      });

      expect(result).toBeNull();
    });

    it('should return null and not throw on exception', async () => {
      chain.insert.mockImplementation(() => { throw new Error('unexpected'); });

      const result = await auditLogService.log({
        actorId: 'actor-uuid-1',
        actorRole: 'admin',
        action: 'test:action',
        resourceType: 'test',
        method: 'GET',
        path: '/test',
      });

      expect(result).toBeNull();
    });

    it('should handle optional fields as null when not provided', async () => {
      chain.single.mockResolvedValue({
        data: { id: 'log-2' },
        error: null,
      });

      await auditLogService.log({
        actorId: 'actor-uuid-1',
        actorRole: 'driver',
        action: 'driver:withdraw',
        resourceType: 'wallet_withdrawal',
        method: 'POST',
        path: '/api/driver/wallet/withdraw',
      });

      const insertCall = chain.insert.mock.calls[0][0];
      expect(insertCall.actor_name).toBeNull();
      expect(insertCall.resource_id).toBeNull();
      expect(insertCall.ip_address).toBeNull();
      expect(insertCall.correlation_id).toBeNull();
      expect(insertCall.before_state).toBeNull();
      expect(insertCall.after_state).toBeNull();
      expect(insertCall.metadata).toBeNull();
      expect(insertCall.created_at).toBeDefined();
    });
  });

  describe('query()', () => {
    it('should query audit logs with default pagination', async () => {
      chain.range.mockResolvedValue({
        data: [{ id: 'log-1', action: 'test' }],
        error: null,
        count: 1,
      });

      const result = await auditLogService.query();

      expect(result.data).toHaveLength(1);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
      });
    });

    it('should apply actor_id filter', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({ actorId: 'actor-uuid-1' });

      expect(chain.eq).toHaveBeenCalledWith('actor_id', 'actor-uuid-1');
    });

    it('should apply action filter', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({ action: 'admin:view-dashboard' });

      expect(chain.eq).toHaveBeenCalledWith('action', 'admin:view-dashboard');
    });

    it('should apply resource_type filter', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({ resourceType: 'order' });

      expect(chain.eq).toHaveBeenCalledWith('resource_type', 'order');
    });

    it('should apply date range filters', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({
        startDate: '2026-01-01T00:00:00Z',
        endDate: '2026-12-31T23:59:59Z',
      });

      expect(chain.gte).toHaveBeenCalledWith('created_at', '2026-01-01T00:00:00Z');
      expect(chain.lte).toHaveBeenCalledWith('created_at', '2026-12-31T23:59:59Z');
    });

    it('should apply custom pagination', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 50 });

      const result = await auditLogService.query({ page: 3, limit: 10 });

      expect(result.pagination.page).toBe(3);
      expect(result.pagination.limit).toBe(10);
      expect(result.pagination.total).toBe(50);
      expect(result.pagination.totalPages).toBe(5);
    });

    it('should enforce max limit of 100', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      const result = await auditLogService.query({ limit: 500 });

      expect(result.pagination.limit).toBe(100);
    });

    it('should enforce minimum limit of 1', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      const result = await auditLogService.query({ limit: 0 });

      expect(result.pagination.limit).toBe(1);
    });

    it('should enforce minimum page of 1', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      const result = await auditLogService.query({ page: -5 });

      expect(result.pagination.page).toBe(1);
    });

    it('should default sort to created_at desc', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query();

      expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should support asc sort order', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({ sortBy: 'action', sortOrder: 'asc' });

      expect(chain.order).toHaveBeenCalledWith('action', { ascending: true });
    });

    it('should sanitize invalid sort column to created_at', async () => {
      chain.range.mockResolvedValue({ data: [], error: null, count: 0 });

      await auditLogService.query({ sortBy: 'invalid_column' });

      expect(chain.order).toHaveBeenCalledWith('created_at', { ascending: false });
    });

    it('should return empty results when supabaseAdmin is null', async () => {
      mockSupabaseAdmin = null;

      vi.resetModules();
      const mod = await import('../../src/services/auditLogService.js');
      const service = mod.auditLogService;

      const result = await service.query();

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });

    it('should return empty results on query error', async () => {
      chain.range.mockResolvedValue({
        data: null,
        error: { message: 'query failed' },
        count: null,
      });

      const result = await auditLogService.query();

      expect(result.data).toEqual([]);
      expect(result.pagination.total).toBe(0);
    });
  });
});
