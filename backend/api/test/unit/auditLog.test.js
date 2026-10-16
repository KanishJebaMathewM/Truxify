import { describe, it, expect, vi, beforeEach } from 'vitest';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { auditLog } from '../../src/middleware/auditLog.js';

// Mock logger or any dependent services if required by the middleware
vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  },
}));

describe('auditLog Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = {
      method: 'POST',
      originalUrl: '/api/orders',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'Mozilla/5.0' },
      user: { id: 'test-user-uuid', role: 'customer' },
      body: { amount: 1000 },
    };
    res = {
      statusCode: 200,
      on: vi.fn((event, callback) => {
        if (event === 'finish') {
          // Simulate response finish lifecycle if auditLog listens to it
          callback();
        }
      }),
    };
    next = vi.fn();
  });

  describe('Middleware Generation & Signature', () => {
    it('should return a valid Express middleware function (req, res, next)', () => {
      const middleware = auditLog({ action: 'order:create', resourceType: 'order' });
      expect(typeof middleware).toBe('function');
      expect(middleware.length).toBe(3);
    });
  });

  describe('Execution Flow', () => {
    it('should call next() successfully on valid request handling', () => {
      const middleware = auditLog({ action: 'order:create', resourceType: 'order' });
      
      middleware(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should attach or log audit metadata correctly without blocking the request pipeline', () => {
      const middleware = auditLog({ action: 'profile:update', resourceType: 'profile' });

      middleware(req, res, next);

      expect(next).toHaveBeenCalled();
    });
  });

  describe('Error & Edge Case Handling', () => {
    it('should handle missing required options or unauthenticated requests gracefully', () => {
      const unauthReq = {
        method: 'GET',
        originalUrl: '/api/public/health',
        headers: {},
      };
      
      const middleware = auditLog(); // No options passed

      expect(() => middleware(unauthReq, res, next)).not.toThrow();
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should handle missing request user and body properties without crashing', () => {
      const minimalReq = {
        method: 'DELETE',
        originalUrl: '/api/items/1',
      };

      const middleware = auditLog({ action: 'item:delete' });

      expect(() => middleware(minimalReq, res, next)).not.toThrow();
      expect(next).toHaveBeenCalled();
    });
  });
});
// ── Mock the audit service ──────────────────────────────────────
const mockLog = vi.fn().mockResolvedValue({ id: 'mock-log-id' });

vi.mock('../../src/services/auditLogService.js', () => ({
  auditLogService: { log: (...args) => mockLog(...args) },
  default: { log: (...args) => mockLog(...args) },
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('auditLog middleware', () => {
  let auditLogMiddleware;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../src/middleware/auditLog.js');
    auditLogMiddleware = mod.auditLog;
  });

  function mockReq(overrides = {}) {
    return {
      user: { id: 'user-1', role: 'admin', fullName: 'Test Admin' },
      method: 'GET',
      path: '/api/v1/admin/dashboard',
      originalUrl: '/api/v1/admin/dashboard',
      ip: '127.0.0.1',
      headers: { 'user-agent': 'TestAgent/1.0' },
      correlationId: 'corr-123',
      requestId: 'req-456',
      params: {},
      body: {},
      ...overrides,
    };
  }

  // The middleware subscribes with res.on('finish', ...), the way Express
  // exposes the real response. This stands in for that: on() records the
  // handlers and finish() fires them, so the tests can drive completion
  // synchronously.
  function mockRes(overrides = {}) {
    const handlers = { finish: [] };
    const res = {
      statusCode: 200,
      on: vi.fn(function (event, handler) {
        (handlers[event] ??= []).push(handler);
        return this;
      }),
      finish: vi.fn(function () {
        for (const handler of handlers.finish) handler();
        return this;
      }),
      ...overrides,
    };
    return res;
  }

  it('should call next() and not log when req.user is missing', () => {
    const req = mockReq({ user: undefined });
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({ action: 'admin:view-dashboard' });
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('should call next() when shouldLog filter returns false', () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'admin:view-dashboard',
      shouldLog: () => false,
    });
    middleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockLog).not.toHaveBeenCalled();
  });

  it('should hook into res.finish and write audit entry', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({ action: 'admin:view-dashboard' });
    middleware(req, res, next);

    // next() is called asynchronously via Promise chain
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    // Simulate response finish
    res.finish();

    // Wait for async audit write
    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.actorId).toBe('user-1');
    expect(logEntry.actorRole).toBe('admin');
    expect(logEntry.action).toBe('admin:view-dashboard');
    expect(logEntry.resourceType).toBe('admin_dashboard');
    expect(logEntry.method).toBe('GET');
    expect(logEntry.path).toBe('/api/v1/admin/dashboard');
    expect(logEntry.ipAddress).toBe('127.0.0.1');
    expect(logEntry.userAgent).toBe('TestAgent/1.0');
    expect(logEntry.correlationId).toBe('corr-123');
    expect(logEntry.requestId).toBe('req-456');
    expect(logEntry.statusCode).toBe(200);
    expect(logEntry.metadata.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should capture before_state when getBeforeState is provided', async () => {
    const beforeData = { id: 'resource-1', name: 'before' };
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'order:cancel',
      getBeforeState: async () => beforeData,
    });
    middleware(req, res, next);

    // Wait for before-state capture and next()
    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.beforeState).toEqual(beforeData);
  });

  it('should capture after_state when getAfterState is provided', async () => {
    const afterData = { id: 'resource-1', status: 'cancelled' };
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'order:cancel',
      getAfterState: async () => afterData,
    });
    middleware(req, res, next);

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.afterState).toEqual(afterData);
  });

  it('should capture after_state with status code available for the caller to check', async () => {
    const afterData = { id: 'resource-1' };
    const req = mockReq();
    const res = mockRes({ statusCode: 500 });
    const next = vi.fn();

    // The getAfterState callback receives res so it can check statusCode
    const middleware = auditLogMiddleware({
      action: 'order:cancel',
      getAfterState: async (req, res) => {
        if (res.statusCode >= 400) return null;
        return afterData;
      },
    });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.afterState).toBeNull();
    expect(logEntry.statusCode).toBe(500);
  });

  it('should capture metadata from getMetadata function', async () => {
    const metadata = { extra_info: 'test' };
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'admin:view-dashboard',
      getMetadata: async () => metadata,
    });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.metadata.extra_info).toBe('test');
    expect(logEntry.metadata.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('should resolve resource ID from req.params.id', async () => {
    const req = mockReq({ params: { id: 'order-123' } });
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({ action: 'order:cancel' });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.resourceId).toBe('order-123');
  });

  it('should resolve resource ID from req.params.orderId', async () => {
    const req = mockReq({ params: { orderId: 'order-456' } });
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({ action: 'order:cancel' });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.resourceId).toBe('order-456');
  });

  it('should resolve resource ID from req.params.userId', async () => {
    const req = mockReq({ params: { userId: 'user-789' } });
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({ action: 'admin:invalidate-cache' });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.resourceId).toBe('user-789');
  });

  it('should use override resourceType when provided', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'order:cancel',
      resourceType: 'custom_resource',
    });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.resourceType).toBe('custom_resource');
  });

  it('should not crash if getBeforeState throws', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'order:cancel',
      getBeforeState: async () => { throw new Error('db error'); },
    });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.beforeState).toBeNull();
  });

  it('should not crash if getMetadata throws', async () => {
    const req = mockReq();
    const res = mockRes();
    const next = vi.fn();

    const middleware = auditLogMiddleware({
      action: 'admin:view-dashboard',
      getMetadata: async () => { throw new Error('metadata error'); },
    });
    middleware(req, res, next);

    await vi.waitFor(() => {
      expect(next).toHaveBeenCalled();
    });

    res.finish();

    await vi.waitFor(() => {
      expect(mockLog).toHaveBeenCalled();
    });

    const logEntry = mockLog.mock.calls[0][0];
    expect(logEntry.metadata).toBeDefined();
  });
});

describe('auditAdminAction convenience', () => {
  let auditAdminAction;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../src/middleware/auditLog.js');
    auditAdminAction = mod.auditAdminAction;
  });

  it('should return a middleware function', () => {
    const middleware = auditAdminAction('admin:view-dashboard');
    expect(typeof middleware).toBe('function');
  });
});

describe('auditWithState convenience', () => {
  let auditWithState;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const mod = await import('../../src/middleware/auditLog.js');
    auditWithState = mod.auditWithState;
  });

  it('should return a middleware function', () => {
    const middleware = auditWithState('order:cancel', 'orders');
    expect(typeof middleware).toBe('function');
  });
});


// === Spec 20 test ===
import { maskPii } from '../../src/middleware/auditLog.js';
describe('maskPii', () => {
  it('masks password', () => { expect(maskPii({ password: 'x' })).toEqual({ password: '***' }); });
  it('masks token', () => { expect(maskPii({ token: 'x' })).toEqual({ token: '***' }); });
  it('recursive', () => { expect(maskPii({ u: { ssn: '1' } })).toEqual({ u: { ssn: '***' } }); });
  it('leaves non-PII', () => { expect(maskPii({ name: 'A' })).toEqual({ name: 'A' }); });
});

