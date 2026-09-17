import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';
import {
  formatValidationIssues,
  validateBody,
  validateParams,
  validateQuery,
  validateArray,
} from '../../../src/middleware/validate.js';

vi.mock('../../../src/middleware/logger.js', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

function createMockRes() {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };
  return res;
}

describe('validate middleware', () => {
  let next;

  beforeEach(() => {
    next = vi.fn();
    vi.clearAllMocks();
  });

  describe('formatValidationIssues', () => {
    it('formats issues with nested paths correctly', () => {
      const error = {
        issues: [
          { path: ['user', 'profile', 'email'], message: 'Invalid email address' },
          { path: ['age'], message: 'Must be at least 18' },
        ],
      };
      const formatted = formatValidationIssues(error);
      expect(formatted).toEqual([
        { field: 'user.profile.email', message: 'Invalid email address' },
        { field: 'age', message: 'Must be at least 18' },
      ]);
    });

    it('formats issues with empty path as body', () => {
      const error = {
        issues: [
          { path: [], message: 'Expected object, received array' },
        ],
      };
      const formatted = formatValidationIssues(error);
      expect(formatted).toEqual([
        { field: 'body', message: 'Expected object, received array' },
      ]);
    });
  });

  describe('validateBody', () => {
    const userSchema = z.object({
      email: z.string().email(),
      age: z.number().int().min(18),
      role: z.enum(['driver', 'admin', 'customer']).optional(),
    });

    it('passes valid request body through to next() and assigns parsed data', () => {
      const req = {
        body: {
          email: 'test@truxify.com',
          age: 25,
          role: 'driver',
        },
      };
      const res = createMockRes();
      const middleware = validateBody(userSchema);

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
      expect(req.body).toEqual({
        email: 'test@truxify.com',
        age: 25,
        role: 'driver',
      });
    });

    it('returns 400 when req.body is null or undefined', () => {
      const req = { body: null };
      const res = createMockRes();
      const middleware = validateBody(userSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Request body is required',
      });
    });

    it('returns 400 with validation details when required fields are missing', () => {
      const req = {
        body: {
          // email and age missing
        },
      };
      const res = createMockRes();
      const middleware = validateBody(userSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toHaveLength(2);
      expect(res.body.details.some((d) => d.field === 'email')).toBe(true);
      expect(res.body.details.some((d) => d.field === 'age')).toBe(true);
    });

    it('returns 400 when fields have invalid types', () => {
      const req = {
        body: {
          email: 'invalid-email-format',
          age: 'not-a-number',
        },
      };
      const res = createMockRes();
      const middleware = validateBody(userSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.some((d) => d.field === 'email')).toBe(true);
      expect(res.body.details.some((d) => d.field === 'age')).toBe(true);
    });

    it('supports custom validator callbacks and refinements', () => {
      const customSchema = z
        .object({
          password: z.string().min(8),
          confirmPassword: z.string(),
        })
        .refine((data) => data.password === data.confirmPassword, {
          message: 'Passwords must match',
          path: ['confirmPassword'],
        });

      const middleware = validateBody(customSchema);

      // Failing case
      const reqFail = {
        body: {
          password: 'SecretPassword123',
          confirmPassword: 'DifferentPassword456',
        },
      };
      const resFail = createMockRes();
      middleware(reqFail, resFail, next);

      expect(next).not.toHaveBeenCalled();
      expect(resFail.statusCode).toBe(400);
      expect(resFail.body.details).toEqual([
        { field: 'confirmPassword', message: 'Passwords must match' },
      ]);

      // Passing case
      const reqPass = {
        body: {
          password: 'MatchingPassword123',
          confirmPassword: 'MatchingPassword123',
        },
      };
      const resPass = createMockRes();
      middleware(reqPass, resPass, next);

      expect(next).toHaveBeenCalledOnce();
    });

    it('handles unexpected exceptions from safeParse gracefully by returning 400', () => {
      const throwingSchema = {
        safeParse: () => {
          throw new Error('Unexpected parsing crash');
        },
      };
      const req = { body: { key: 'val' } };
      const res = createMockRes();
      const middleware = validateBody(throwingSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation failed',
        details: [{ field: 'body', message: 'Unexpected parsing crash' }],
      });
    });
  });

  describe('validateParams', () => {
    const paramsSchema = z.object({
      id: z.string().uuid(),
      orderId: z.string().regex(/^#TRX-\d+$/, 'Invalid order ID format'),
    });

    it('passes valid request params through to next()', () => {
      const req = {
        params: {
          id: '123e4567-e89b-12d3-a456-426614174000',
          orderId: '#TRX-1002',
        },
      };
      const res = createMockRes();
      const middleware = validateParams(paramsSchema);

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
      expect(req.params.id).toBe('123e4567-e89b-12d3-a456-426614174000');
    });

    it('returns 400 when req.params is null or undefined', () => {
      const req = { params: null };
      const res = createMockRes();
      const middleware = validateParams(paramsSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Request params are required',
      });
    });

    it('returns 400 when params fail validation', () => {
      const req = {
        params: {
          id: 'non-uuid-string',
          orderId: 'invalid-order-id',
        },
      };
      const res = createMockRes();
      const middleware = validateParams(paramsSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details).toHaveLength(2);
    });

    it('handles unexpected exceptions from params safeParse gracefully', () => {
      const throwingSchema = {
        safeParse: () => {
          throw new Error('Params parsing error');
        },
      };
      const req = { params: { id: '1' } };
      const res = createMockRes();
      const middleware = validateParams(throwingSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation failed',
        details: [{ field: 'params', message: 'Params parsing error' }],
      });
    });
  });

  describe('validateQuery', () => {
    const querySchema = z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(20),
      status: z.enum(['active', 'completed', 'cancelled']).optional(),
    });

    it('passes valid query parameters through and coerces types', () => {
      const req = {
        query: {
          page: '3',
          limit: '50',
          status: 'active',
        },
      };
      const res = createMockRes();
      const middleware = validateQuery(querySchema);

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
      expect(req.query).toEqual({
        page: 3,
        limit: 50,
        status: 'active',
      });
    });

    it('returns 400 when query parameters are invalid', () => {
      const req = {
        query: {
          limit: '500', // exceeds max 100
          status: 'unknown_status',
        },
      };
      const res = createMockRes();
      const middleware = validateQuery(querySchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Validation failed');
      expect(res.body.details.some((d) => d.field === 'limit')).toBe(true);
      expect(res.body.details.some((d) => d.field === 'status')).toBe(true);
    });

    it('handles read-only query properties via Object.defineProperty', () => {
      const req = {};
      Object.defineProperty(req, 'query', {
        value: { page: '2', limit: '10' },
        writable: false,
        configurable: true,
      });
      const res = createMockRes();
      const middleware = validateQuery(querySchema);

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(req.query).toEqual({
        page: 2,
        limit: 10,
      });
    });

    it('handles unexpected exceptions from query safeParse gracefully', () => {
      const throwingSchema = {
        safeParse: () => {
          throw new Error('Query parsing error');
        },
      };
      const req = { query: { q: 'search' } };
      const res = createMockRes();
      const middleware = validateQuery(throwingSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Validation failed',
        details: [{ field: 'query', message: 'Query parsing error' }],
      });
    });
  });

  describe('validateArray', () => {
    const itemSchema = z.object({
      id: z.string(),
      quantity: z.number().int().positive(),
    });

    it('passes valid array in request body through to next()', () => {
      const req = {
        body: [
          { id: 'item-1', quantity: 5 },
          { id: 'item-2', quantity: 10 },
        ],
      };
      const res = createMockRes();
      const middleware = validateArray(itemSchema);

      middleware(req, res, next);

      expect(next).toHaveBeenCalledOnce();
      expect(res.statusCode).toBeNull();
      expect(req.body).toEqual([
        { id: 'item-1', quantity: 5 },
        { id: 'item-2', quantity: 10 },
      ]);
    });

    it('returns 400 when req.body is not an array', () => {
      const req = {
        body: { id: 'single-item', quantity: 1 },
      };
      const res = createMockRes();
      const middleware = validateArray(itemSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body).toEqual({
        error: 'Expected an array in request body',
      });
    });

    it('returns 400 with details when array items fail validation', () => {
      const req = {
        body: [
          { id: 'item-1', quantity: 5 },
          { id: 'item-2', quantity: -3 }, // invalid positive quantity
          { quantity: 2 }, // missing id
        ],
      };
      const res = createMockRes();
      const middleware = validateArray(itemSchema);

      middleware(req, res, next);

      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.body.error).toBe('Array validation failed');
      expect(res.body.details).toHaveLength(2);
      expect(res.body.details.some((d) => d.field === 'quantity')).toBe(true);
      expect(res.body.details.some((d) => d.field === 'id')).toBe(true);
    });
  });
});
