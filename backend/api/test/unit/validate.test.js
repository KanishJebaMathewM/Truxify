import { describe, it, expect, vi, beforeEach } from 'vitest';
import { z } from 'zod';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import {
  formatValidationIssues,
  validateBody,
  validateParams,
  validateQuery,
  validateArray,
} from '../../src/middleware/validate.js';

const testSchema = z.object({
  name: z.string(),
  age: z.number(),
});

describe('formatValidationIssues', () => {
  it('formats Zod error issues into field/message pairs', () => {
    const result = testSchema.safeParse({ name: 123, age: 'not-a-number' });
    expect(result.success).toBe(false);
    const issues = formatValidationIssues(result.error);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: 'name', message: expect.any(String) }),
        expect.objectContaining({ field: 'age', message: expect.any(String) }),
      ])
    );
  });

  it('uses "body" as field name when path is empty', () => {
    const result = z.string().safeParse(123);
    expect(result.success).toBe(false);
    const issues = formatValidationIssues(result.error);
    expect(issues[0].field).toBe('body');
  });
});

describe('validateBody', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls next() with valid body', () => {
    const mw = validateBody(testSchema);
    const req = { body: { name: 'Alice', age: 30 }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 400 with errors for invalid body', () => {
    const mw = validateBody(testSchema);
    const req = { body: { name: 123 }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Validation failed',
      details: expect.any(Array),
    }));
  });

  it('replaces req.body with parsed data', () => {
    const mw = validateBody(testSchema);
    const req = { body: { name: 'Bob', age: 25 }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(req.body).toEqual({ name: 'Bob', age: 25 });
  });
});

describe('validateParams', () => {
  it('calls next() with valid params', () => {
    const schema = z.object({ id: z.string().uuid() });
    const mw = validateParams(schema);
    const req = { params: { id: '123e4567-e89b-12d3-a456-426614174000' }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns 400 for invalid params', () => {
    const schema = z.object({ id: z.string().uuid() });
    const mw = validateParams(schema);
    const req = { params: { id: 'not-a-uuid' }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateQuery', () => {
  it('calls next() with valid query', () => {
    const schema = z.object({ page: z.coerce.number().int().positive() });
    const mw = validateQuery(schema);
    const req = { query: { page: '5' }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.query.page).toBe(5);
  });

  it('returns 400 for invalid query', () => {
    const schema = z.object({ page: z.coerce.number().int().positive() });
    const mw = validateQuery(schema);
    const req = { query: { page: '-1' }, requestId: 'req-1' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe('validateArray', () => {
  it('calls next() with valid array', () => {
    const itemSchema = z.string();
    const mw = validateArray(itemSchema);
    const req = { body: ['a', 'b', 'c'] };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.body).toEqual(['a', 'b', 'c']);
  });

  it('returns 400 when body is not an array', () => {
    const itemSchema = z.string();
    const mw = validateArray(itemSchema);
    const req = { body: 'not-an-array' };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Expected an array in request body',
    }));
  });

  it('returns 400 with details for invalid array items', () => {
    const itemSchema = z.string();
    const mw = validateArray(itemSchema);
    const req = { body: ['valid', 123] };
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();

    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
      error: 'Array validation failed',
    }));
  });
});
