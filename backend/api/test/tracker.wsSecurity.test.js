import { describe, it, expect, vi, beforeEach } from 'vitest';

const db = vi.hoisted(() => ({
  redis: null,
}));

vi.mock('../src/config/db.js', () => ({
  get mongoDb() { return null; },
  get redisClient() { return db.redis; },
  get firebaseAdmin() { return null; },
  get supabase() { return null; },
}));

vi.mock('../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const {
  isWebSocketUpgradeAllowed,
  rejectConnectionWithTokenInUrl,
  getClientIp,
  closeWebSocketServer,
} = await import('../src/sockets/tracker.js');

function makeWs(overrides = {}) {
  return {
    send: vi.fn(),
    close: vi.fn(),
    ...overrides,
  };
}

function makeRequest({ ip = '203.0.113.7', forwardedFor, url = '/ws/tracking' } = {}) {
  return {
    headers: forwardedFor ? { 'x-forwarded-for': forwardedFor } : {},
    socket: { remoteAddress: ip },
    url,
  };
}

describe('issue #5826 — token must never be sent in the URL', () => {
  it('refuses a connection whose URL carries a token (4001) and reports it', () => {
    const ws = makeWs();
    const reqUrl = new URL('http://localhost/ws/tracking?token=eyJhbGciOiJIUzI1NiJ9');

    const rejected = rejectConnectionWithTokenInUrl(ws, reqUrl);

    expect(rejected).toBe(true);
    expect(ws.send).toHaveBeenCalledWith(
      expect.stringContaining('must not be sent in the URL'),
    );
    expect(ws.close).toHaveBeenCalledWith(
      4001,
      expect.stringContaining('must not be sent in the URL'),
    );
  });

  it('accepts connections with no token query parameter', () => {
    const ws = makeWs();
    const reqUrl = new URL('http://localhost/ws/tracking');

    expect(rejectConnectionWithTokenInUrl(ws, reqUrl)).toBe(false);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it('ignores an unrelated query parameter', () => {
    const ws = makeWs();
    const reqUrl = new URL('http://localhost/ws/tracking?driver_id=abc');

    expect(rejectConnectionWithTokenInUrl(ws, reqUrl)).toBe(false);
  });
});

describe('issue #5826 — getClientIp trusts only the TCP peer', () => {
  it('ignores a spoofed X-Forwarded-For header', () => {
    const req = makeRequest({ ip: '203.0.113.7', forwardedFor: '1.2.3.4, 5.6.7.8' });
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  it('falls back to connection.remoteAddress and then unknown', () => {
    const req1 = {
      headers: {},
      socket: { remoteAddress: null },
      connection: { remoteAddress: '198.51.100.9' },
    };
    expect(getClientIp(req1)).toBe('198.51.100.9');

    const req2 = { headers: {} };
    expect(getClientIp(req2)).toBe('unknown');
  });
});

describe('issue #5826 — upgrade limiter fails closed', () => {
  beforeEach(() => {
    db.redis = null;
  });

  it('enforces the per-IP cap via the in-memory fallback when Redis errors (no fail-open)', async () => {
    db.redis = { incr: vi.fn().mockRejectedValue(new Error('redis down')) };
    const req = makeRequest();

    for (let i = 0; i < 5; i++) {
      await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(true);
    }
    await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(false);
  });

  it('enforces the per-IP cap via Redis when available', async () => {
    let attempts = 0;
    db.redis = {
      incr: vi.fn().mockImplementation(() => {
        attempts++;
        return Promise.resolve(attempts);
      }),
      expire: vi.fn().mockResolvedValue(1),
      ttl: vi.fn().mockResolvedValue(60),
    };
    const req = makeRequest();

    for (let i = 0; i < 5; i++) {
      await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(true);
    }
    await expect(isWebSocketUpgradeAllowed(req)).resolves.toBe(false);
    expect(db.redis.expire).toHaveBeenCalledWith(expect.stringContaining('ws:upgrade:'), 60);
  });
});
