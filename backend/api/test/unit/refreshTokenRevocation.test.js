import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn() }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: mocks.from }) }));
vi.mock('../../src/security/tokenFamilyManager.js', () => ({
  generateFamilyId: () => 'family-1', registerTokenFamily: vi.fn(),
  verifyAndRotateFamily: () => ({ valid: true, nextGen: 1 }),
  revokeTokenFamily: vi.fn(), isFamilyRevoked: () => false
}));
import { revokeToken, revokeAllUserTokens, rotateRefreshToken, hashRefreshToken } from '../../src/services/refreshTokenService.js';

let query, writeError;
beforeEach(() => {
  writeError = null;
  mocks.insert.mockReset().mockReturnValue({ select: () => ({ single: async () => ({ data: { token_hash: 'new' }, error: null }) }) });
  query = {
    update: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(), insert: mocks.insert,
    single: vi.fn().mockResolvedValue({ data: { user_id: 'u1', is_revoked: false, expires_at: new Date(Date.now() + 60000).toISOString() }, error: null }),
    then: (resolve, reject) => Promise.resolve({ data: null, error: writeError }).then(resolve, reject)
  };
  mocks.from.mockReset().mockReturnValue(query);
});

describe('refresh-token revocation database failures', () => {
  it.each([
    ['single token', revokeToken, 'test-token', 'Failed to revoke refresh token'],
    ['all user tokens', revokeAllUserTokens, 'u1', 'Failed to revoke user refresh tokens']
  ])('rejects a denied %s write and preserves its cause', async (_label, revoke, arg, message) => {
    writeError = { code: '42501', message: 'database write denied' };
    await expect(revoke(arg)).rejects.toMatchObject({ message, cause: writeError });
  });

  it('preserves hashed token filtering on successful revocation', async () => {
    await expect(revokeToken('test-token')).resolves.toBeUndefined();
    expect(query.update).toHaveBeenCalledWith(expect.objectContaining({ is_revoked: true }));
    expect(query.eq).toHaveBeenCalledWith('token_hash', hashRefreshToken('test-token'));
  });

  it('preserves user and active-token filtering on successful bulk revocation', async () => {
    await expect(revokeAllUserTokens('u1')).resolves.toBeUndefined();
    expect(query.eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(query.eq).toHaveBeenCalledWith('is_revoked', false);
  });

  it('aborts rotation before creating a replacement when old-token revocation fails', async () => {
    writeError = { message: 'update unavailable' };
    await expect(rotateRefreshToken('test-token', 'device', {})).rejects.toMatchObject({ cause: writeError });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it('still creates a replacement after successful revocation', async () => {
    const rotated = await rotateRefreshToken('test-token', 'device', {});
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(rotated.token).toMatch(/^[a-f0-9]{80}$/);
  });

  it('does not claim all sessions revoked when reuse cleanup fails', async () => {
    query.single.mockResolvedValueOnce({ data: { user_id: 'u1', is_revoked: true }, error: null });
    writeError = { message: 'bulk update unavailable' };
    await expect(rotateRefreshToken('test-token', 'device', {})).rejects.toMatchObject({
      message: 'Failed to revoke user refresh tokens', cause: writeError
    });
    expect(mocks.insert).not.toHaveBeenCalled();
  });
});
