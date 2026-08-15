import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSupabaseAdmin = {
  from: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('AuditLogService', () => {
  let auditLogService;

  beforeEach(() => {
    vi.clearAllMocks();
    mockSupabaseAdmin.from.mockReset();
  });

  describe('log actorId guard', () => {
    it('log returns null when actorId is missing', async () => {
      const { auditLogService: svc } = await import('../../../src/services/auditLogService.js');
      const result = await svc.log({
        actorId: undefined,
        actorRole: 'admin',
        action: 'admin:view',
        resourceType: 'order',
        method: 'GET',
        path: '/api/orders',
      });
      expect(result).toBeNull();
    });

    it('log returns null when actorId is null', async () => {
      const { auditLogService: svc } = await import('../../../src/services/auditLogService.js');
      const result = await svc.log({
        actorId: null,
        actorRole: 'admin',
        action: 'admin:view',
        resourceType: 'order',
        method: 'GET',
        path: '/api/orders',
      });
      expect(result).toBeNull();
    });
  });

  describe('query pagination clamping', () => {
    it('clamps page to minimum of 1', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
          }),
        }),
      });
      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      const { auditLogService: svc } = await import('../../../src/services/auditLogService.js');
      const result = await svc.query({ page: -5 });
      expect(result.pagination.page).toBeGreaterThanOrEqual(1);
    });

    it('clamps limit to maximum of 100', async () => {
      const mockSelect = vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ data: [], error: null, count: 0 }),
          }),
        }),
      });
      mockSupabaseAdmin.from.mockReturnValue({ select: mockSelect });

      const { auditLogService: svc } = await import('../../../src/services/auditLogService.js');
      const result = await svc.query({ limit: 500 });
      expect(result.pagination.limit).toBeLessThanOrEqual(100);
    });
  });
});
