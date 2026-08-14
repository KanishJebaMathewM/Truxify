import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';
import { TrackingTokenService } from '../../../src/services/trackingTokenService.js';

const mockSupabase = {
  from: vi.fn(),
};

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

describe('TrackingTokenService', () => {
  let service;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TrackingTokenService({
      supabase: mockSupabase,
      supabaseAdmin: mockSupabase,
      logger: mockLogger,
    });
  });

  describe('generateRawToken', () => {
    it('generates a non-empty base64url token', () => {
      const token = service.generateRawToken();
      expect(typeof token).toBe('string');
      expect(token.length).toBeGreaterThan(0);
    });

    it('generates unique tokens on each call', () => {
      const token1 = service.generateRawToken();
      const token2 = service.generateRawToken();
      expect(token1).not.toBe(token2);
    });
  });

  describe('hashToken', () => {
    it('produces a consistent sha256 hex hash', () => {
      const raw = 'test-token-123';
      const hash = service.hashToken(raw);
      expect(hash).toHaveLength(64); // sha256 = 64 hex chars
      expect(hash).toBe(crypto.createHash('sha256').update(raw).digest('hex'));
    });
  });

  describe('getExpiryDate', () => {
    it('returns a future ISO date string', () => {
      const expiry = service.getExpiryDate();
      expect(typeof expiry).toBe('string');
      const expiryDate = new Date(expiry);
      expect(expiryDate.getTime()).toBeGreaterThan(Date.now());
    });

    it('returns a date approximately 7 days in the future', () => {
      const before = Date.now();
      const expiry = service.getExpiryDate();
      const expiryDate = new Date(expiry);
      const diffMs = expiryDate.getTime() - before;
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThan(6.9);
      expect(diffDays).toBeLessThan(7.1);
    });
  });

  describe('createToken', () => {
    it('throws when orderDisplayId is null', async () => {
      await expect(
        service.createToken({ orderDisplayId: null, createdBy: 'user-1' })
      ).rejects.toThrow('orderDisplayId is required');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('throws when orderDisplayId is undefined', async () => {
      await expect(
        service.createToken({ orderDisplayId: undefined, createdBy: 'user-1' })
      ).rejects.toThrow('orderDisplayId is required');
      expect(mockLogger.error).toHaveBeenCalled();
    });

    it('inserts token into supabase with correct fields', async () => {
      const mockSingle = vi.fn().mockResolvedValue({
        data: {
          id: 'token-123',
          order_display_id: 'order-abc',
          expires_at: new Date().toISOString(),
          created_at: new Date().toISOString(),
        },
        error: null,
      });
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: mockSingle,
          }),
        }),
      });

      const result = await service.createToken({
        orderDisplayId: 'order-abc',
        createdBy: 'user-123',
      });

      expect(mockSupabase.from).toHaveBeenCalledWith('tracking_tokens');
      expect(mockSingle).toHaveBeenCalled();
      expect(result.token).toBeDefined();
      expect(result.order_display_id).toBe('order-abc');
    });

    it('throws and logs when supabase insert fails', async () => {
      mockSupabase.from.mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'Insert failed' },
            }),
          }),
        }),
      });

      await expect(
        service.createToken({ orderDisplayId: 'order-abc', createdBy: 'user-1' })
      ).rejects.toThrow('Failed to create tracking token');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('validateToken', () => {
    it('returns valid for a non-expired, non-revoked token', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString(); // 1 day from now
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'token-123',
                order_display_id: 'order-abc',
                expires_at: futureDate,
                revoked: false,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.validateToken('raw-token-xyz');
      expect(result.valid).toBe(true);
      expect(result.orderDisplayId).toBe('order-abc');
    });

    it('returns invalid for expired token', async () => {
      const pastDate = new Date(Date.now() - 86400000).toISOString(); // 1 day ago
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'token-123',
                order_display_id: 'order-abc',
                expires_at: pastDate,
                revoked: false,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.validateToken('raw-token-xyz');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('expired');
    });

    it('returns invalid for revoked token', async () => {
      const futureDate = new Date(Date.now() + 86400000).toISOString();
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: {
                id: 'token-123',
                order_display_id: 'order-abc',
                expires_at: futureDate,
                revoked: true,
              },
              error: null,
            }),
          }),
        }),
      });

      const result = await service.validateToken('raw-token-xyz');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('revoked');
    });

    it('returns invalid for not-found token', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: null,
            }),
          }),
        }),
      });

      const result = await service.validateToken('non-existent-token');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('not_found');
    });

    it('returns validation_error on database failure', async () => {
      mockSupabase.from.mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: null,
              error: { message: 'DB error' },
            }),
          }),
        }),
      });

      const result = await service.validateToken('raw-token-xyz');
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('validation_error');
    });
  });
});
