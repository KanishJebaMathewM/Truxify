import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockFrom,
  mockInsert,
  mockInsertSelect,
  mockInsertSingle,
  mockSelect,
  mockSelectEq,
  mockSelectSingle,
  mockUpdate,
} = vi.hoisted(() => {
  const mInsertSingle = vi.fn();
  const mInsertSelect = vi.fn(() => ({ single: mInsertSingle }));
  const mInsert = vi.fn(() => ({ select: mInsertSelect }));

  const mSelectSingle = vi.fn();
  const mSelectEq = vi.fn(() => ({ single: mSelectSingle }));
  const mSelect = vi.fn(() => ({ eq: mSelectEq }));

  const mUpdateEq2 = vi.fn().mockResolvedValue({ data: null, error: null });
  const mUpdateEq1 = vi.fn(() => ({ eq: mUpdateEq2 }));
  const mUpdate = vi.fn(() => ({ eq: mUpdateEq1 }));

  const mFrom = vi.fn((table) => {
    if (table === 'refresh_tokens') {
      return {
        insert: mInsert,
        select: mSelect,
        update: mUpdate,
      };
    }
    return {};
  });

  return {
    mockFrom: mFrom,
    mockInsert: mInsert,
    mockInsertSelect: mInsertSelect,
    mockInsertSingle: mInsertSingle,
    mockSelect: mSelect,
    mockSelectEq: mSelectEq,
    mockSelectSingle: mSelectSingle,
    mockUpdate: mUpdate,
  };
});

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: mockFrom,
  })),
}));

import refreshTokenService, {
  createRefreshToken,
  rotateRefreshToken,
  revokeToken,
  revokeAllUserTokens,
  generateRefreshToken,
} from '../../src/services/refreshTokenService.js';

describe('refreshTokenService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('generateRefreshToken', () => {
    it('generates an 80-character hex random string', () => {
      const token = generateRefreshToken();
      expect(typeof token).toBe('string');
      expect(token).toHaveLength(80);
      expect(/^[0-9a-f]{80}$/.test(token)).toBe(true);
    });
  });

  describe('createRefreshToken', () => {
    it('inserts a new refresh token record into supabase and returns data', async () => {
      const mockRecord = {
        id: 'rt-1',
        user_id: 'usr-1',
        token: 'mock-token-hex',
        device_id: 'dev-1',
        device_info: 'Chrome / Win11',
        is_revoked: false,
      };
      mockInsertSingle.mockResolvedValue({ data: mockRecord, error: null });

      const result = await createRefreshToken('usr-1', 'dev-1', 'Chrome / Win11');
      expect(result).toEqual(mockRecord);
      expect(mockFrom).toHaveBeenCalledWith('refresh_tokens');
      expect(mockInsert).toHaveBeenCalledTimes(1);
    });

    it('throws error when database insert fails', async () => {
      mockInsertSingle.mockResolvedValue({ data: null, error: { message: 'DB Error' } });

      await expect(createRefreshToken('usr-1', 'dev-1', 'iOS')).rejects.toThrow(
        'Failed to create refresh token'
      );
    });
  });

  describe('rotateRefreshToken', () => {
    it('throws error when token record is not found', async () => {
      mockSelectSingle.mockResolvedValue({ data: null, error: { message: 'Not found' } });

      await expect(rotateRefreshToken('non-existent', 'dev-1', 'Safari')).rejects.toThrow(
        'Invalid or expired refresh token'
      );
    });

    it('detects token reuse and revokes all user sessions when token is revoked', async () => {
      mockSelectSingle.mockResolvedValue({
        data: {
          user_id: 'victim-user',
          token: 'compromised-token',
          is_revoked: true,
        },
        error: null,
      });

      await expect(
        rotateRefreshToken('compromised-token', 'hacker-dev', 'Tor Browser')
      ).rejects.toThrow('Token reuse detected. All sessions revoked.');
    });

    it('throws error when token has expired past expires_at', async () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60 * 24); // 1 day ago
      mockSelectSingle.mockResolvedValue({
        data: {
          user_id: 'usr-1',
          token: 'old-expired-token',
          is_revoked: false,
          expires_at: pastDate.toISOString(),
        },
        error: null,
      });

      await expect(
        rotateRefreshToken('old-expired-token', 'dev-1', 'Firefox')
      ).rejects.toThrow('Refresh token expired');
    });

    it('successfully revokes old token and issues a new refresh token', async () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 10);
      mockSelectSingle.mockResolvedValue({
        data: {
          user_id: 'usr-1',
          token: 'valid-active-token',
          is_revoked: false,
          expires_at: futureDate.toISOString(),
        },
        error: null,
      });

      const newRecord = {
        user_id: 'usr-1',
        token: 'new-active-token',
        device_id: 'dev-2',
        device_info: 'Android',
        is_revoked: false,
      };
      mockInsertSingle.mockResolvedValue({ data: newRecord, error: null });

      const result = await rotateRefreshToken('valid-active-token', 'dev-2', 'Android');
      expect(result).toEqual(newRecord);
    });
  });

  describe('revokeToken & revokeAllUserTokens', () => {
    it('calls supabase update to revoke a specific token', async () => {
      await revokeToken('target-token');
      expect(mockFrom).toHaveBeenCalledWith('refresh_tokens');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ is_revoked: true })
      );
    });

    it('calls supabase update to revoke all tokens for a user', async () => {
      await revokeAllUserTokens('user-target');
      expect(mockFrom).toHaveBeenCalledWith('refresh_tokens');
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ is_revoked: true })
      );
    });

    it('exports default service object matching named functions', () => {
      expect(refreshTokenService.createRefreshToken).toBe(createRefreshToken);
      expect(refreshTokenService.rotateRefreshToken).toBe(rotateRefreshToken);
      expect(refreshTokenService.revokeToken).toBe(revokeToken);
      expect(refreshTokenService.revokeAllUserTokens).toBe(revokeAllUserTokens);
    });
  });
});
