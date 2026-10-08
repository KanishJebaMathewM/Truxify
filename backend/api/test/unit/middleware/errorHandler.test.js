import { describe, it, expect, vi, beforeEach } from 'vitest';
import { errorHandler } from '../../../src/middleware/errorHandler.js';

const mockReq = (overrides = {}) => ({
  requestId: 'req-123',
  ip: '127.0.0.1',
  method: 'POST',
  originalUrl: '/api/test',
  ...overrides,
});

const mockRes = () => {
  const res = {
    statusCode: null,
    jsonData: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(data) {
      this.jsonData = data;
      return this;
    },
  };
  return res;
};

const mockNext = vi.fn();

describe('errorHandler middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 413 for entity.too.large errors', () => {
    const err = { type: 'entity.too.large' };
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(413);
    expect(res.jsonData.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Payload too large',
      details: {},
    });
    expect(mockNext).not.toHaveBeenCalled();
  });

  it('returns 400 for SyntaxError with status 400 and body', () => {
    const err = new SyntaxError('Unexpected token');
    err.status = 400;
    err.body = '{}';
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toEqual({
      code: 'MALFORMED_JSON',
      message: 'Malformed JSON payload',
      details: {},
    });
  });

  it('passes through SyntaxError without status 400 to generic handler', () => {
    const err = new SyntaxError('Unexpected token');
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(500);
  });

  it('returns 413 for MulterError with LIMIT_FILE_SIZE code', () => {
    const err = { name: 'MulterError', code: 'LIMIT_FILE_SIZE', message: 'File too large' };
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(413);
    expect(res.jsonData.error).toEqual({
      code: 'PAYLOAD_TOO_LARGE',
      message: 'File upload error: File too large',
      details: { multerCode: 'LIMIT_FILE_SIZE' },
    });
  });

  it('returns 400 for MulterError with other codes', () => {
    const err = { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE', message: 'Unexpected field' };
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(400);
  });

  it('returns 400 with details for ZodError', () => {
    const err = {
      name: 'ZodError',
      issues: [
        { path: ['email'], message: 'Invalid email' },
        { path: ['age'], message: 'Must be positive' },
      ],
    };
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(400);
    expect(res.jsonData.error).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: { email: 'Invalid email', age: 'Must be positive' },
    });
  });

  it('returns 500 for generic errors without specific handling', () => {
    const err = new Error('Something broke');
    const req = mockReq();
    const res = mockRes();
    errorHandler(err, req, res, mockNext);
    expect(res.statusCode).toBe(500);
    expect(res.jsonData.error).toEqual({
      code: 'INTERNAL_ERROR',
      message: 'Critical Internal Server Error.',
      details: {},
    });
  });
});
