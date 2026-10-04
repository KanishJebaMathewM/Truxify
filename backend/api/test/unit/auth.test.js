import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

describe('authenticate middleware - non bypass flow', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'false';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BYPASS_AUTH;
  });

  it('returns 401 when authorization header missing', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const mockLoggerWarn = vi.fn();
    vi.doMock('../../src/middleware/logger.js', () => ({
      default: {
        warn: mockLoggerWarn,
        error: vi.fn(),
        info: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        child: vi.fn(() => ({
          warn: vi.fn(),
          error: vi.fn(),
          info: vi.fn(),
          debug: vi.fn(),
        })),
      },
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = { headers: {}, requestId: 'test-req-id' };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockLoggerWarn).toHaveBeenCalledWith(
      {
        event: 'AUTH_NO_TOKEN',
        requestId: 'test-req-id',
      },
      'Missing or malformed Bearer Authorization header',
    );
  });

  it('returns 500 when supabase missing for supabase token', async () => {
    const token = jwt.sign({ iss: 'https://test.supabase.co/auth/v1' }, 'secret');
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: {},
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 401 when supabase getUser fails', async () => {
    const token = jwt.sign({ iss: 'https://test.supabase.co/auth/v1' }, 'secret');
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: null },
          error: { message: 'invalid token' },
        }),
      },
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: {},
      supabase,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('authenticates valid supabase user', async () => {
    const token = jwt.sign({ iss: 'https://test.supabase.co/auth/v1' }, 'secret');
    const supabase = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: {
            user: { id: 'supabase-user-uuid' },
          },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 'user-1',
                  firebase_uid: 'firebase-user-id',
                  role: 'driver',
                  full_name: 'John Supa',
                  phone: '9999999999',
                  is_active: true,
                },
                error: null,
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: {},
      supabase,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('driver');
    expect(req.user.fullName).toBe('John Supa');
  });

  it('returns 500 when firebase admin missing', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 500 when supabase missing', async () => {
    const firebaseAdmin = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'firebase-user',
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 403 when profile not found', async () => {
    const firebaseAdmin = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'firebase-user',
        }),
      }),
    };

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: null,
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin,
      supabase,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
  });

  it('returns 500 when database query fails', async () => {
    const firebaseAdmin = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'firebase-user',
        }),
      }),
    };

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: null,
                error: {
                  message: 'db failure',
                },
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin,
      supabase,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('authenticates valid firebase user', async () => {
    const firebaseAdmin = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'firebase-user',
        }),
      }),
    };

    const supabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: {
                  id: 'user-1',
                  firebase_uid: 'firebase-user',
                  role: 'driver',
                  full_name: 'John',
                  phone: '9999999999',
                  is_active: true,
                },
                error: null,
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin,
      supabase,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('driver');
  });

  it('returns 401 when firebase throws', async () => {
    const firebaseAdmin = {
      auth: () => ({
        verifyIdToken: vi.fn().mockRejectedValue(
          new Error('invalid token')
        ),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin,
      supabase: {},
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });
});

describe('authenticate middleware - BYPASS_AUTH flow', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'true';
    process.env.NODE_ENV = 'test';
    process.env.ENABLE_TEST_AUTH = 'true';
    process.env.DEV_ACCESS_TOKEN = 'dev-token-123';
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.NODE_ENV;
    delete process.env.ENABLE_TEST_AUTH;
    delete process.env.DEV_ACCESS_TOKEN;
  });

  it('returns 503 when BYPASS_AUTH is enabled in production', async () => {
    process.env.NODE_ENV = 'production';

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = { headers: { 'x-user-id': 'some-uuid' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(503);
  });

  it('strips dev auth headers in production and falls through to token flow', async () => {
    process.env.BYPASS_AUTH = 'false';
    process.env.NODE_ENV = 'production';

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        'x-user-id': 'some-uuid',
        'x-user-role': 'driver',
        'authorization': 'Bearer token123',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    // Headers should have been deleted before any logic ran
    expect(req.headers['x-user-id']).toBeUndefined();
    expect(req.headers['x-user-role']).toBeUndefined();
    // Falls through to token flow → 500 because supabase is null
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it('returns 401 when BYPASS_AUTH is enabled but x-user-id header is missing', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = { headers: {} };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    await authenticate(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ hint: expect.any(String) })
    );
  });

  it('sets req.user and calls next when x-user-id is provided', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        'x-dev-access-token': 'dev-token-123',
        'x-user-id': 'test-uuid-123',
        'x-user-role': 'driver',
        'x-user-name': 'Test Driver',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user).toMatchObject({
      id: 'test-uuid-123',
      role: 'driver',
      fullName: 'Test Driver',
      uid: 'test_firebase_uid_123',
    });
  });

  it('does not trust x-user-id/x-user-role headers when ENABLE_TEST_AUTH is unset', async () => {
    delete process.env.ENABLE_TEST_AUTH;

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        'x-user-id': 'victim-uuid',
        'x-user-role': 'admin',
        'authorization': 'Bearer token123',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authenticate(req, res, next);

    // Headers must be stripped (not trusted) and the request must fall
    // through to real token verification rather than impersonating a user.
    expect(req.headers['x-user-id']).toBeUndefined();
    expect(req.headers['x-user-role']).toBeUndefined();
    expect(req.user).toBeUndefined();
    expect(next).not.toHaveBeenCalled();
  });

  it('defaults role to customer and name to Test User when headers are absent', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        'x-dev-access-token': 'dev-token-123',
        'x-user-id': 'test-uuid-456',
      },
    };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.role).toBe('customer');
    expect(req.user.fullName).toBe('Test User');
  });
});

describe('requireRole middleware', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns 401 when req.user is not set', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');

    const middleware = requireRole(['driver']);
    const req = {};
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized: Authentication required.',
      hint: 'Please provide a valid authentication token to access this resource.',
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('safely handles req.user as null or undefined without throwing TypeError', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');
    const middleware = requireRole(['driver']);

    for (const userVal of [undefined, null]) {
      const req = { user: userVal };
      const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn(),
      };
      const next = vi.fn();

      expect(() => middleware(req, res, next)).not.toThrow();
      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith({
      error: 'Unauthorized: Authentication required.',
      hint: 'Please provide a valid authentication token to access this resource.',
    });
      expect(next).not.toHaveBeenCalled();
    }
  });

  it('throws an error on initialization if allowedRoles is missing or empty', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');

    expect(() => requireRole()).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
    expect(() => requireRole([])).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
    expect(() => requireRole('driver')).toThrow('requireRole middleware requires a non-empty array of allowed roles.');
  });

  it('returns 403 when user role is not in allowedRoles', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');

    const middleware = requireRole(['driver']);
    const req = { user: { role: 'customer' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    middleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.stringContaining('customer'),
      })
    );
  });

  it('calls next when user role is in allowedRoles', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');

    const middleware = requireRole(['driver', 'admin']);
    const req = { user: { role: 'driver' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('allows access when multiple roles are allowed and user matches one', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: null,
      supabase: null,
    }));

    const { requireRole } = await import('../../src/middleware/auth.js');

    const middleware = requireRole(['admin', 'customer']);
    const req = { user: { role: 'customer' } };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
  });
});

describe('authenticate middleware - Redis caching', () => {
  let originalBypassAuth;

  beforeEach(() => {
    originalBypassAuth = process.env.BYPASS_AUTH;
    process.env.BYPASS_AUTH = 'false';
    vi.resetModules();
  });

  afterEach(() => {
    if (originalBypassAuth === undefined) {
      delete process.env.BYPASS_AUTH;
    } else {
      process.env.BYPASS_AUTH = originalBypassAuth;
    }
  });

  it('retrieves user profile from Redis on cache hit and skips database query', async () => {
    const cachedUser = {
      id: 'cached-user-123',
      uid: 'cached-firebase-uid',
      role: 'customer',
      fullName: 'Cached User',
      phone: '+1234567890',
      isActive: true
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedProfile: vi.fn().mockResolvedValue(cachedUser),
        setCachedProfile: vi.fn(),
        invalidateCachedProfile: vi.fn(),
        isValidCachedProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const firebaseAdminMock = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'cached-firebase-uid',
        }),
      }),
    };

    const supabaseMock = {
      from: vi.fn(),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: firebaseAdminMock,
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(profileCacheMock.getCachedProfile).toHaveBeenCalledWith('cached-firebase-uid');
    expect(supabaseMock.from).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(cachedUser);
  });

  it('treats cached profiles with invalid shape as a cache miss and invalidates the cache key', async () => {
    const invalidCachedUser = {
      fullName: 'Corrupted User',
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedProfile: vi.fn().mockResolvedValue(invalidCachedUser),
        setCachedProfile: vi.fn().mockResolvedValue(),
        invalidateCachedProfile: vi.fn().mockResolvedValue(),
        isValidCachedProfile: vi.fn().mockReturnValue(false),
      };
    })();

    const firebaseAdminMock = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'corrupted-firebase-uid',
        }),
      }),
    };

    const dbProfile = {
      id: 'db-user-999',
      firebase_uid: 'corrupted-firebase-uid',
      role: 'customer',
      full_name: 'Database User',
      phone: '+9876543210',
      is_active: true
    };

    const supabaseMock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: dbProfile, error: null }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: firebaseAdminMock,
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(profileCacheMock.invalidateCachedProfile).toHaveBeenCalledWith('corrupted-firebase-uid');
    expect(next).toHaveBeenCalled();
    expect(req.user.id).toBe('db-user-999');
  });

  it('caches tombstone with TOMBSTONE_TTL_SECONDS when profile query returns no results', async () => {
    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedProfile: vi.fn().mockResolvedValue(null),
        setCachedProfile: vi.fn().mockResolvedValue(),
        invalidateCachedProfile: vi.fn().mockResolvedValue(),
        isValidCachedProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const firebaseAdminMock = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'nonexistent-firebase-uid',
        }),
      }),
    };

    const supabaseMock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: null, error: null }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: firebaseAdminMock,
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { TOMBSTONE_TTL_SECONDS } = await import('../../src/lib/profileCache.js');
    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(profileCacheMock.setCachedProfile).toHaveBeenCalledWith(
      'nonexistent-firebase-uid',
      { isActive: false },
      TOMBSTONE_TTL_SECONDS
    );
  });

  it('queries database and populates Redis on cache miss', async () => {
    const dbProfile = {
      id: 'db-user-123',
      firebase_uid: 'miss-firebase-uid',
      role: 'driver',
      full_name: 'Database User',
      phone: '+9876543210',
      is_active: true
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedProfile: vi.fn().mockResolvedValue(null),
        setCachedProfile: vi.fn().mockResolvedValue(),
        invalidateCachedProfile: vi.fn().mockResolvedValue(),
        isValidCachedProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const firebaseAdminMock = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'miss-firebase-uid',
        }),
      }),
    };

    const supabaseMock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: dbProfile,
                error: null,
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: firebaseAdminMock,
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(profileCacheMock.getCachedProfile).toHaveBeenCalledWith('miss-firebase-uid');
    expect(profileCacheMock.setCachedProfile).toHaveBeenCalledWith('miss-firebase-uid', {
      id: dbProfile.id,
      uid: dbProfile.firebase_uid,
      role: dbProfile.role,
      fullName: dbProfile.full_name,
      phone: dbProfile.phone,
      isActive: true
    });
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: dbProfile.id,
      uid: dbProfile.firebase_uid,
      role: dbProfile.role,
      fullName: dbProfile.full_name,
      phone: dbProfile.phone,
      isActive: true
    });
  });

  it('falls back to database query gracefully when Redis client throws error', async () => {
    const dbProfile = {
      id: 'db-user-456',
      firebase_uid: 'error-firebase-uid',
      role: 'customer',
      full_name: 'Resilient User',
      phone: '+1111111111',
      is_active: true
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedProfile: vi.fn().mockRejectedValue(new Error('Redis connection lost')),
        setCachedProfile: vi.fn().mockResolvedValue(),
        invalidateCachedProfile: vi.fn().mockResolvedValue(),
        isValidCachedProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const firebaseAdminMock = {
      auth: () => ({
        verifyIdToken: vi.fn().mockResolvedValue({
          uid: 'error-firebase-uid',
        }),
      }),
    };

    const supabaseMock = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () =>
              Promise.resolve({
                data: dbProfile,
                error: null,
              }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: firebaseAdminMock,
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
        authorization: 'Bearer token123',
      },
    };

    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };

    const next = vi.fn();

    await authenticate(req, res, next);

    expect(profileCacheMock.getCachedProfile).toHaveBeenCalledWith('error-firebase-uid');
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual({
      id: dbProfile.id,
      uid: dbProfile.firebase_uid,
      role: dbProfile.role,
      fullName: dbProfile.full_name,
      phone: dbProfile.phone,
      isActive: true
    });
  });

  it('serves a supabase profile from cache and skips the profiles query', async () => {
    const token = jwt.sign({ iss: 'https://test.supabase.co/auth/v1' }, 'secret');
    const cached = {
      id: 'supabase-user-uuid',
      uid: null,
      role: 'customer',
      fullName: 'Cached Supa',
      phone: '+911111111111',
      isActive: true,
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedSupabaseProfile: vi.fn().mockResolvedValue(cached),
        setCachedSupabaseProfile: vi.fn().mockResolvedValue(),
        invalidateCachedSupabaseProfile: vi.fn().mockResolvedValue(),
        isValidCachedSupabaseProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const fromSpy = vi.fn();
    const supabaseMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'supabase-user-uuid' } },
          error: null,
        }),
      },
      from: fromSpy,
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: {},
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(profileCacheMock.getCachedSupabaseProfile).toHaveBeenCalledWith('supabase-user-uuid');
    expect(fromSpy).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalled();
    expect(req.user).toEqual(cached);
  });

  it('caches a supabase profile bounded by the token expiry', async () => {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const expSeconds = nowSeconds + 120; // token expires in 2 minutes
    const token = jwt.sign(
      { iss: 'https://test.supabase.co/auth/v1', exp: expSeconds },
      'secret'
    );

    const dbProfile = {
      id: 'supabase-user-uuid',
      firebase_uid: null,
      role: 'customer',
      full_name: 'Fresh Supa',
      phone: '+912222222222',
      is_active: true,
    };

    const profileCacheMock = await (async () => {
      const actual = await vi.importActual('../../src/lib/profileCache.js');
      return {
        ...actual,
        getCachedSupabaseProfile: vi.fn().mockResolvedValue(null),
        setCachedSupabaseProfile: vi.fn().mockResolvedValue(),
        invalidateCachedSupabaseProfile: vi.fn().mockResolvedValue(),
        isValidCachedSupabaseProfile: vi.fn().mockReturnValue(true),
      };
    })();

    const supabaseMock = {
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'supabase-user-uuid' } },
          error: null,
        }),
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: () => Promise.resolve({ data: dbProfile, error: null }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
      createUserClient: () => null,
      firebaseAdmin: {},
      supabase: supabaseMock,
    }));
    vi.doMock('../../src/lib/profileCache.js', () => profileCacheMock);

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = { headers: { authorization: `Bearer ${token}` } };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(profileCacheMock.setCachedSupabaseProfile).toHaveBeenCalled();
    const setCall = profileCacheMock.setCachedSupabaseProfile.mock.calls[0];
    expect(setCall[0]).toBe('supabase-user-uuid');
    const ttl = setCall[2];
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(120);
  });
});