/**
 * Unit tests for backend/api/src/middleware/validate.js
 *
 * Coverage:
 *   - validateBody: 400 on invalid body, calls next on valid body, mutates req.body
 *   - validateParams: 400 on invalid params, calls next on valid params, mutates req.params
 *   - validateQuery: 400 on invalid query, calls next on valid query, mutates req.query
 *   - Empty body / empty query with optional fields passes through
 *
 * Run with:  npm run test:unit -- test/unit/validate.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { validateBody, validateParams, validateQuery } from '../../src/middleware/validate.js';
import { z } from 'zod';

function makeRes() {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  };
}

function makeNext() {
  return vi.fn();
}

describe('validateBody middleware', () => {
  const schema = z.object({ name: z.string(), age: z.number() });

  it('calls next() when body is valid', () => {
    const req = { body: { name: 'Alice', age: 30 } };
    const res = makeRes();
    const next = makeNext();
    validateBody(schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('mutates req.body to parsed data', () => {
    const req = { body: { name: 'Bob', age: 25, extraField: 'should-be-removed' } };
    const res = makeRes();
    const next = makeNext();
    validateBody(schema)(req, res, next);
    expect(req.body).toEqual({ name: 'Bob', age: 25 });
    expect(req.body.extraField).toBeUndefined();
  });

  it('returns 400 with field-level details when body is invalid', () => {
    const req = { body: { name: 123, age: 'thirty' } };
    const res = makeRes();
    const next = makeNext();
    validateBody(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'name', message: expect.any(String) }),
        expect.objectContaining({ field: 'age', message: expect.any(String) }),
      ]),
    });
  });

  it('returns 400 for completely empty body', () => {
    const req = { body: {} };
    const res = makeRes();
    const next = makeNext();
    validateBody(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('does not call next when validation fails', () => {
    const req = { body: { name: 1, age: 2 } };
    const res = makeRes();
    const next = makeNext();
    validateBody(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });

  it('throws when schema is invalid (does not have safeParse)', () => {
    const req = { body: { name: 'Alice', age: 30 } };
    const res = makeRes();
    const next = makeNext();
    expect(() => validateBody(null)(req, res, next)).toThrow();
  });

  it('passes all requests with empty schema object', () => {
    const emptySchema = z.object({});
    const req = { body: { randomField: 'value' } };
    const res = makeRes();
    const next = makeNext();
    validateBody(emptySchema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe('validateParams middleware', () => {
  const schema = z.object({ id: z.string().uuid() });

  it('calls next() when params are valid', () => {
    const req = { params: { id: '550e8400-e29b-41d4-a716-446655440000' } };
    const res = makeRes();
    const next = makeNext();
    validateParams(schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('mutates req.params to parsed data', () => {
    const req = { params: { id: '550e8400-e29b-41d4-a716-446655440000', extraField: 'should-be-removed' } };
    const res = makeRes();
    const next = makeNext();
    validateParams(schema)(req, res, next);
    expect(req.params).toEqual({ id: '550e8400-e29b-41d4-a716-446655440000' });
    expect(req.params.extraField).toBeUndefined();
  });

  it('returns 400 with field details for invalid params', () => {
    const req = { params: { id: 'not-a-uuid' } };
    const res = makeRes();
    const next = makeNext();
    validateParams(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'id', message: expect.any(String) }),
      ]),
    });
  });

  it('does not call next when params validation fails', () => {
    const req = { params: { id: 'invalid' } };
    const res = makeRes();
    const next = makeNext();
    validateParams(schema)(req, res, next);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('validateQuery middleware', () => {
  const schema = z.object({ page: z.coerce.number().int().positive().optional() });

  it('calls next() when query is valid', () => {
    const req = { query: { page: '5' } };
    const res = makeRes();
    const next = makeNext();
    validateQuery(schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('mutates req.query to parsed/coerced data', () => {
    const req = { query: { page: '10', extraField: 'should-be-removed' } };
    const res = makeRes();
    const next = makeNext();
    validateQuery(schema)(req, res, next);
    expect(req.query).toEqual({ page: 10 });
    expect(req.query.extraField).toBeUndefined();
  });

  it('returns 400 for invalid query values', () => {
    const req = { query: { page: '-1' } };
    const res = makeRes();
    const next = makeNext();
    validateQuery(schema)(req, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: 'Validation failed',
      details: expect.arrayContaining([
        expect.objectContaining({ field: 'page', message: expect.any(String) }),
      ]),
    });
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next() when query is empty (all fields optional)', () => {
    const req = { query: {} };
    const res = makeRes();
    const next = makeNext();
    validateQuery(schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });
});
