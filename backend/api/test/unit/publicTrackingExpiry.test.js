import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { TrackingTokenService } from '../../src/services/trackingTokenService.js';

const mocks = vi.hoisted(() => ({ token: null, from: vi.fn(), gps: vi.fn() }));
vi.mock('../../src/middleware/logger.js', () => ({ default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../../src/config/db.js', () => ({ supabase: null, supabaseAdmin: { from: mocks.from } }));
vi.mock('../../src/middleware/rateLimiter.js', () => ({ createStore: () => null, safeIpKeyGenerator: () => 'expiry-tests' }));
vi.mock('../../src/models/GpsLog.js', () => ({ default: { find: mocks.gps } }));
const { default: router } = await import('../../src/routes/publicTrackingRoutes.js');
const app = express();
app.use('/api/public', router);
const now = '2026-10-06T10:00:00.000Z';
const rawToken = 'test-tracking-share-token';
let service;
let contentSpies;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(now));
  vi.clearAllMocks();
  service = new TrackingTokenService({ supabaseAdmin: { from: mocks.from } });
  mocks.token = { id: 'token-one', order_display_id: '#FF20261006ABCDEFGHIJKL', revoked: false, expires_at: now };
  mocks.from.mockImplementation(table => {
    expect(table).toBe('tracking_tokens');
    return { select() { return { eq(column, value) {
      expect(column).toBe('token_hash');
      expect(value).toBe(service.hashToken(rawToken));
      return { maybeSingle: async () => ({ data: mocks.token, error: null }) };
    } }; } };
  });
  // Content boundaries are controlled; the router, hashing, database token
  // lookup and expiration decision are real and must gate every content read.
  contentSpies = [
    vi.spyOn(TrackingTokenService.prototype, 'getOrderForPublicTracking').mockResolvedValue({ order_display_id: mocks.token.order_display_id, status: 'in_transit' }),
    vi.spyOn(TrackingTokenService.prototype, 'getOrderTimeline').mockResolvedValue([]),
    vi.spyOn(TrackingTokenService.prototype, 'getDriverLocation').mockResolvedValue(null),
    vi.spyOn(TrackingTokenService.prototype, 'getOrderRouteCoords').mockResolvedValue({ pickup_lat: 28, pickup_lng: 77, drop_lat: 19, drop_lng: 73 }),
  ];
  const gpsChain = { sort: () => gpsChain, limit: () => gpsChain, lean: async () => [] };
  mocks.gps.mockReturnValue(gpsChain);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

for (const suffix of ['', '/route', '/history']) {
  describe(`public tracking ${suffix || 'details'} expiry gate`, () => {
    it('denies access at the exact expiration instant before content reads', async () => {
      const response = await request(app).get(`/api/public/tracking/${rawToken}${suffix}`);
      expect(response.status).toBe(410);
      for (const spy of contentSpies) expect(spy).not.toHaveBeenCalled();
      expect(mocks.gps).not.toHaveBeenCalled();
    });
    it('denies a non-finite stored expiration before content reads', async () => {
      mocks.token.expires_at = 'infinity';
      const response = await request(app).get(`/api/public/tracking/${rawToken}${suffix}`);
      expect(response.status).toBe(400);
      for (const spy of contentSpies) expect(spy).not.toHaveBeenCalled();
      expect(mocks.gps).not.toHaveBeenCalled();
    });
    it('preserves access immediately before expiry', async () => {
      mocks.token.expires_at = '2026-10-06T10:00:00.001Z';
      const response = await request(app).get(`/api/public/tracking/${rawToken}${suffix}`);
      expect(response.status).toBe(200);
    });
  });
}

it.each(['infinity', '-infinity', 'not-a-date'])('fails closed for invalid expiry %s', async expiresAt => {
  mocks.token.expires_at = expiresAt;
  await expect(service.validateToken(rawToken)).resolves.toEqual({ valid: false, reason: 'validation_error' });
});
it('keeps the expired response and token ID for past expirations', async () => {
  mocks.token.expires_at = '2026-10-06T09:59:59.999Z';
  await expect(service.validateToken(rawToken)).resolves.toEqual({ valid: false, reason: 'expired', tokenId: 'token-one' });
});
it('preserves revocation precedence over an invalid expiration', async () => {
  mocks.token.revoked = true;
  mocks.token.expires_at = 'infinity';
  await expect(service.validateToken(rawToken)).resolves.toEqual({ valid: false, reason: 'revoked' });
});
