import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const db = vi.hoisted(() => ({ from: vi.fn(), insert: vi.fn(), update: vi.fn(), record: null }));
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ from: db.from }) }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { warn: vi.fn(), error: vi.fn() } }));
import { rotateRefreshToken, hashRefreshToken } from '../../src/services/refreshTokenService.js';
import { refreshToken } from '../../src/controllers/authController.js';
import { clearTokenFamilyStore, registerTokenFamily, isFamilyRevoked } from '../../src/security/tokenFamilyManager.js';

const now = new Date('2026-01-01T12:00:00.000Z');
let writes, consumedRows;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
  clearTokenFamilyStore();
  registerTokenFamily('family-one', 0);
  db.record = { user_id: 'user-one', family_id: 'family-one', generation: 0, is_revoked: false, expires_at: new Date(now.getTime() + 60000).toISOString() };
  writes = [];
  consumedRows = [{ token_hash: 'consumed' }];
  db.insert.mockReset().mockImplementation(record => ({ select: () => ({ single: async () => ({ data: record, error: null }) }) }));
  db.update.mockReset().mockImplementation(value => {
    const chain = {
      eq: vi.fn((key, value) => { writes.push([key, value]); return chain; }),
      select: () => ({ then: resolve => Promise.resolve({ data: consumedRows, error: null }).then(resolve) }),
      then: resolve => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  });
  db.from.mockReset().mockReturnValue({
    select: () => ({ eq: () => ({ single: async () => ({ data: { ...db.record }, error: null }) }) }),
    update: db.update, insert: db.insert,
  });
});
afterEach(() => { vi.useRealTimers(); clearTokenFamilyStore(); });

const expired = [
  ['elapsed', '2025-12-31T12:00:00.000Z'], ['exact deadline', now.toISOString()],
  ['invalid date', 'not-a-date'], ['Postgres infinity', 'infinity'],
  ['missing', undefined], ['null', null],
];
describe('refresh token expiry before family advancement', () => {
  it.each(expired)('rejects %s without issuing a replacement or consuming the token', async (_label, expiry) => {
    db.record.expires_at = expiry;
    await expect(rotateRefreshToken('old-token', 'device-one', {})).rejects.toThrow('Refresh token expired');
    expect(db.insert).not.toHaveBeenCalled();
    expect(writes).toContainEqual(['token_hash', hashRefreshToken('old-token')]);
    expect(writes.some(([key]) => key === 'user_id')).toBe(false);
    expect(writes.some(([key]) => key === 'is_revoked')).toBe(false);
  });
  it('preserves a valid rotation and the next family generation', async () => {
    const result = await rotateRefreshToken('old-token', 'device-one', {});
    expect(result.generation).toBe(1);
    expect(result.token).toMatch(/^[a-f0-9]{80}$/);
    expect(db.insert).toHaveBeenCalledOnce();
    expect(db.insert.mock.calls[0][0]).toMatchObject({ user_id: 'user-one', family_id: 'family-one', generation: 1 });
    expect(writes).toContainEqual(['is_revoked', false]);
  });
  it('keeps replay detection and family revocation for already revoked tokens', async () => {
    db.record.is_revoked = true;
    db.record.expires_at = now.toISOString();
    await expect(rotateRefreshToken('old-token', 'device-one', {})).rejects.toThrow('Token reuse detected');
    expect(isFamilyRevoked('family-one')).toBe(true);
    expect(writes).toContainEqual(['user_id', 'user-one']);
    expect(db.insert).not.toHaveBeenCalled();
  });
  it('does not let a stale in-memory generation override the database', async () => {
    // Another replica owns the real family state; this replica's per-process map is stale.
    registerTokenFamily('family-one', 7);
    const result = await rotateRefreshToken('old-token', 'device-one', {});
    expect(result.generation).toBe(1);
    expect(isFamilyRevoked('family-one')).toBe(false);
    expect(writes.some(([key]) => key === 'user_id')).toBe(false);
  });
  it('treats a conditional update that consumed no row as replay and revokes every session', async () => {
    consumedRows = [];
    await expect(rotateRefreshToken('old-token', 'device-one', {})).rejects.toThrow('Token reuse detected');
    expect(isFamilyRevoked('family-one')).toBe(true);
    expect(writes).toContainEqual(['user_id', 'user-one']);
  });
  it.each([['deadline', now.toISOString()], ['invalid', 'infinity']])('returns HTTP 401 for %s expiry rather than minting an access token', async (_label, expiry) => {
    db.record.expires_at = expiry;
    const app = express();
    app.use(express.json());
    app.post('/refresh', refreshToken);
    app.use((err, _req, res, _next) => res.status(err.statusCode || 500).json({ error: err.message }));
    const response = await request(app).post('/refresh').send({ refreshToken: 'old-token', deviceId: 'device-one' });
    expect(response.status).toBe(401);
    expect(response.body).not.toHaveProperty('accessToken');
    expect(db.insert).not.toHaveBeenCalled();
  });
});
