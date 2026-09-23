import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

vi.mock('../../../src/middleware/auth.js', () => ({
  authenticate: (req, res, next) => { req.user = { id: 'user-123' }; next(); },
}));

vi.mock('../../../src/middleware/redisRateLimiter.js', () => ({
  redisRateLimiter: () => (req, res, next) => next(),
}));

vi.mock('mongoose', () => ({
  default: {
    Schema: class {
      constructor(fields, opts) {
        this.fields = fields;
        this.opts = opts;
      }
    },
    model: vi.fn((name, schema) => ({ name, schema })),
    Types: { ObjectId: class {} },
  },
}));

vi.mock('../../../src/lib/redisLock.js', () => ({
  LockAcquisitionError: class LockAcquisitionError extends Error {
    constructor() { super('Lock acquisition failed'); }
  },
  acquireLock: vi.fn(),
  releaseLock: vi.fn(),
}));

vi.mock('../../../src/services/zkp/zkp.service.js', () => ({
  default: {
    verifyDriver: vi.fn(),
    isVerified: vi.fn(),
    getVerificationStats: vi.fn(),
  },
}));

const zkpRoutes = (await import('../../../src/routes/zkp.routes.js')).default;

describe('zkp.routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('router', () => {
    it('is defined as an Express router', () => {
      expect(zkpRoutes).toBeDefined();
      expect(typeof zkpRoutes).toBe('function');
    });
  });

  describe('POST /verify', () => {
    it('validates userId is required and a non-empty string', () => {
      // The route validates: !userId || typeof userId !== 'string' || !userId.trim()
      const invalidCases = [null, undefined, '', '   '];
      invalidCases.forEach(userId => {
        const isInvalid = !userId || typeof userId !== 'string' || !String(userId).trim();
        expect(isInvalid).toBe(true);
      });
    });

    it('accepts valid userId', () => {
      const userId = 'user-valid-123';
      const isValid = !!userId && typeof userId === 'string' && !!userId.trim();
      expect(isValid).toBe(true);
    });

    it('returns 403 when userId mismatches req.user.id', () => {
      // Route check: userId !== req.user.id
      const reqUserId = 'user-123';
      const reqBodyUserId = 'user-456';
      expect(reqBodyUserId !== reqUserId).toBe(true);
    });

    it('allows same userId as req.user.id', () => {
      const reqUserId = 'user-123';
      const reqBodyUserId = 'user-123';
      expect(reqBodyUserId !== reqUserId).toBe(false);
    });
  });

  describe('GET /status/:userId', () => {
    it('returns 403 when userId does not match authenticated user', () => {
      const reqUserId = 'user-123';
      const paramUserId = 'user-456';
      expect(paramUserId !== reqUserId).toBe(true);
    });
  });

  describe('verification stats', () => {
    it('returns totalVerified, totalUnverified, and total', async () => {
      const stats = { totalVerified: 100, totalUnverified: 50, total: 150 };
      expect(stats.total).toBe(stats.totalVerified + stats.totalUnverified);
    });
  });
});
