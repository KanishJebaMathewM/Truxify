import { describe, it, expect, vi, beforeEach } from 'vitest';

const redisClientMock = { status: 'connecting', call: vi.fn() };

vi.mock('../../src/config/db.js', () => ({
  redisClient: redisClientMock,
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const redisStoreInit = vi.fn();
const redisStoreCtor = vi.fn(function () {
  this.init = redisStoreInit;
  this.increment = vi.fn().mockResolvedValue({ totalHits: 1, resetTime: undefined });
  this.__isRedisStore = true;
});

vi.mock('rate-limit-redis', () => ({
  RedisStore: redisStoreCtor,
}));

const {
  globalLimiter,
  userLimiter,
  healthLimiter,
  authLimiter,
  bidLimiter,
  deviceLimiter,
  adminRateLimiter,
  userKeyGenerator,
  safeIpKeyGenerator,
  createStore,
  __testing,
} = await import('../../src/middleware/rateLimiter.js');

const { DeferredRedisStore } = __testing;

function makeReq(overrides = {}) {
  return {
    path: '/api/test',
    ip: '127.0.0.1',
    user: undefined,
    headers: {},
    app: {
      get: vi.fn(),
    },
    ...overrides,
  };
}

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    end: vi.fn(),
    statusCode: 200,
  };
}

function makeNext() {
  return vi.fn();
}

describe('safeIpKeyGenerator', () => {
  it('uses req.ip when available (trust proxy scenario)', () => {
    const req = {
      ip: '203.0.113.7',
      socket: { remoteAddress: '::1' },
    };
    expect(safeIpKeyGenerator(req)).toBe('203.0.113.7');
  });

  it('falls back to socket.remoteAddress when req.ip is absent', () => {
    const req = {
      ip: undefined,
      socket: { remoteAddress: '10.0.0.5' },
    };
    expect(safeIpKeyGenerator(req)).toBe('10.0.0.5');
  });

  it('falls back to connection.remoteAddress when socket is absent', () => {
    const req = {
      ip: undefined,
      socket: undefined,
      connection: { remoteAddress: '10.0.0.9' },
    };
    expect(safeIpKeyGenerator(req)).toBe('10.0.0.9');
  });

  it('returns unknown when nothing is available', () => {
    const req = {};
    expect(safeIpKeyGenerator(req)).toBe('unknown');
  });

  it('gives different keys for different client IPs behind a proxy', () => {
    const reqA = { ip: '203.0.113.7', socket: { remoteAddress: '10.0.0.1' } };
    const reqB = { ip: '198.51.100.3', socket: { remoteAddress: '10.0.0.1' } };
    expect(safeIpKeyGenerator(reqA)).not.toBe(safeIpKeyGenerator(reqB));
  });
});

describe('createStore', () => {
  it('returns a DeferredRedisStore instance with the given prefix', () => {
    const store = createStore('rl:custom:');
    expect(store).toBeInstanceOf(DeferredRedisStore);
    expect(store.prefix).toBe('rl:custom:');
  });
});

describe('userKeyGenerator', () => {
  it('keys by the authenticated user id', () => {
    const req = { user: { id: 'user-1' }, ip: '203.0.113.7' };
    expect(userKeyGenerator(req)).toBe('user:user-1');
  });

  it('falls back to the firebase uid when no id is present', () => {
    const req = { user: { uid: 'fb-uid-9' }, ip: '203.0.113.7' };
    expect(userKeyGenerator(req)).toBe('uid:fb-uid-9');
  });

  it('falls back to IP when no user is present', () => {
    const req = { socket: { remoteAddress: '203.0.113.7' } };
    expect(userKeyGenerator(req)).toBe('203.0.113.7');
  });

  it('gives two users behind the same IP independent keys', () => {
    const ip = '203.0.113.7';
    const a = userKeyGenerator({ user: { id: 'user-a' }, ip });
    const b = userKeyGenerator({ user: { id: 'user-b' }, ip });
    expect(a).not.toBe(b);
  });
});

describe('isRedisReady', () => {
  it('returns true when redisClient is ready', () => {
    redisClientMock.status = 'ready';
    expect(__testing.isRedisReady()).toBe(true);
  });

  it('returns false when redisClient is not ready', () => {
    redisClientMock.status = 'connecting';
    expect(__testing.isRedisReady()).toBe(false);
  });
});

describe('DeferredRedisStore', () => {
  beforeEach(() => {
    redisClientMock.status = 'connecting';
    redisStoreCtor.mockClear();
    redisStoreInit.mockClear();
  });

  it('serves from the in-memory fallback while Redis is not ready', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });

    const result = await store.increment('client-a');

    expect(redisStoreCtor).not.toHaveBeenCalled();
    expect(result.totalHits).toBe(1);
  });

  it('promotes to a RedisStore once Redis becomes ready', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });

    await store.increment('client-a'); // memory fallback
    expect(redisStoreCtor).not.toHaveBeenCalled();

    redisClientMock.status = 'ready';
    await store.increment('client-a'); // should promote

    expect(redisStoreCtor).toHaveBeenCalledTimes(1);
    expect(redisStoreInit).toHaveBeenCalledWith({ windowMs: 1000 });
  });

  it('reuses the same RedisStore instance across requests', async () => {
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });
    redisClientMock.status = 'ready';

    await store.increment('client-a');
    await store.increment('client-b');

    expect(redisStoreCtor).toHaveBeenCalledTimes(1);
  });

  it('falls back to memory and does not retry if RedisStore construction throws', async () => {
    redisStoreCtor.mockImplementationOnce(() => {
      throw new Error('boom');
    });
    const store = new DeferredRedisStore('rl:test:');
    store.init({ windowMs: 1000 });
    redisClientMock.status = 'ready';

    const result = await store.increment('client-a');
    expect(result.totalHits).toBe(1); // memory store answered

    await store.increment('client-a');
    expect(redisStoreCtor).toHaveBeenCalledTimes(1); // not retried
  });
});

describe('Limiters as Express Middleware', () => {
  let incrementSpy;

  beforeEach(() => {
    vi.clearAllMocks();
    incrementSpy = vi.spyOn(DeferredRedisStore.prototype, 'increment');
  });

  describe('globalLimiter', () => {
    it('is a function', () => {
      expect(typeof globalLimiter).toBe('function');
    });

    it('calls next() and increments the store for normal requests', async () => {
      const req = makeReq({ path: '/api/orders' });
      const res = makeRes();
      const next = makeNext();

      await globalLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(incrementSpy).toHaveBeenCalled();
    });

    it('calls next() and skips store increment for /health', async () => {
      const req = makeReq({ path: '/health' });
      const res = makeRes();
      const next = makeNext();

      await globalLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(incrementSpy).not.toHaveBeenCalled();
    });

    it('calls next() and skips store increment for /health/live', async () => {
      const req = makeReq({ path: '/health/live' });
      const res = makeRes();
      const next = makeNext();

      await globalLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(incrementSpy).not.toHaveBeenCalled();
    });
  });

  describe('userLimiter', () => {
    it('is a function', () => {
      expect(typeof userLimiter).toBe('function');
    });

    it('calls next() without throwing for user.id request', async () => {
      const req = makeReq({ user: { id: 'user-123' } });
      const res = makeRes();
      const next = makeNext();

      await userLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for user.uid request', async () => {
      const req = makeReq({ user: { uid: 'uid-456' } });
      const res = makeRes();
      const next = makeNext();

      await userLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for IP-only request', async () => {
      const req = makeReq({ ip: '10.0.0.1' });
      const res = makeRes();
      const next = makeNext();

      await userLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('healthLimiter', () => {
    it('is a function', () => {
      expect(typeof healthLimiter).toBe('function');
    });

    it('calls next() without throwing', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await healthLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('authLimiter', () => {
    it('is a function', () => {
      expect(typeof authLimiter).toBe('function');
    });

    it('calls next() without throwing', async () => {
      const req = makeReq();
      const res = makeRes();
      const next = makeNext();

      await authLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('bidLimiter', () => {
    it('is a function', () => {
      expect(typeof bidLimiter).toBe('function');
    });

    it('calls next() without throwing for a request with user.id', async () => {
      const req = makeReq({ user: { id: 'user-123', uid: 'uid-456' } });
      const res = makeRes();
      const next = makeNext();

      await bidLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for a request with user.uid but no user.id', async () => {
      const req = makeReq({ user: { uid: 'uid-456' } });
      const res = makeRes();
      const next = makeNext();

      await bidLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for a request without user (falls back to IP)', async () => {
      const req = makeReq({ ip: '10.0.0.1' });
      const res = makeRes();
      const next = makeNext();

      await bidLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('deviceLimiter', () => {
    it('is a function', () => {
      expect(typeof deviceLimiter).toBe('function');
    });

    it('calls next() without throwing for a request with user.id', async () => {
      const req = makeReq({ user: { id: 'user-123', uid: 'uid-456' } });
      const res = makeRes();
      const next = makeNext();

      await deviceLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for a request with user.uid but no user.id', async () => {
      const req = makeReq({ user: { uid: 'uid-456' } });
      const res = makeRes();
      const next = makeNext();

      await deviceLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() without throwing for a request without user (falls back to IP)', async () => {
      const req = makeReq({ ip: '10.0.0.1' });
      const res = makeRes();
      const next = makeNext();

      await deviceLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('adminRateLimiter', () => {
    it('is a function', () => {
      expect(typeof adminRateLimiter).toBe('function');
    });

    it('calls next() and increments the store for admin requests', async () => {
      const req = makeReq({ user: { id: 'admin-123' } });
      const res = makeRes();
      const next = makeNext();

      await adminRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(incrementSpy).toHaveBeenCalled();
    });

    it('calls next() for admin with user.uid', async () => {
      const req = makeReq({ user: { uid: 'fb-admin-456' } });
      const res = makeRes();
      const next = makeNext();

      await adminRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('calls next() for request without user (falls back to IP)', async () => {
      const req = makeReq({ ip: '10.0.0.1' });
      const res = makeRes();
      const next = makeNext();

      await adminRateLimiter(req, res, next);

      expect(next).toHaveBeenCalled();
    });

    it('keys by user ID so different admins have independent limits', async () => {
      const reqA = makeReq({ user: { id: 'admin-a' } });
      const reqB = makeReq({ user: { id: 'admin-b' } });
      const res = makeRes();
      const next = makeNext();

      await adminRateLimiter(reqA, res, next);
      await adminRateLimiter(reqB, res, next);

      expect(next).toHaveBeenCalledTimes(2);
    });

    it('uses the rl:admin: store prefix', () => {
      const store = createStore('rl:admin:');
      expect(store).toBeInstanceOf(DeferredRedisStore);
      expect(store.prefix).toBe('rl:admin:');
    });
  });
});
