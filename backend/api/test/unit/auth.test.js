import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import jwt from 'jsonwebtoken';

describe('authenticate middleware - non bypass flow', () => {
  beforeEach(() => {
    process.env.BYPASS_AUTH = 'false';
    vi.resetModules();
  });

  it('returns 401 when authorization header missing', async () => {
    vi.doMock('../../src/config/db.js', () => ({
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
  });

  it('returns 500 when supabase missing for supabase token', async () => {
    const token = jwt.sign({ iss: 'https://test.supabase.co/auth/v1' }, 'secret');
    vi.doMock('../../src/config/db.js', () => ({
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
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'user-1',
                    firebase_uid: 'firebase-user-id',
                    role: 'driver',
                    full_name: 'John Supa',
                    phone: '9999999999',
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
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
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: null,
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
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
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
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
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: {
                    id: 'user-1',
                    firebase_uid: 'firebase-user',
                    role: 'driver',
                    full_name: 'John',
                    phone: '9999999999',
                  },
                  error: null,
                }),
            }),
          }),
        }),
      }),
    };

    vi.doMock('../../src/config/db.js', () => ({
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
    vi.resetModules();
  });

  afterEach(() => {
    delete process.env.BYPASS_AUTH;
    delete process.env.NODE_ENV;
  });

  it('returns 503 when BYPASS_AUTH is enabled in production', async () => {
    process.env.NODE_ENV = 'production';

    vi.doMock('../../src/config/db.js', () => ({
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
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: {
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

  it('defaults role to customer and name to Test User when headers are absent', async () => {
    vi.doMock('../../src/config/db.js', () => ({
      firebaseAdmin: null,
      supabase: null,
    }));

    const { authenticate } = await import('../../src/middleware/auth.js');

    const req = {
      headers: { 'x-user-id': 'test-uuid-456' },
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

  it('returns 501 when req.user is not set', async () => {
    vi.doMock('../../src/config/db.js', () => ({
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

    middleware(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(501);
  });

  it('returns 403 when user role is not in allowedRoles', async () => {
    vi.doMock('../../src/config/db.js', () => ({
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