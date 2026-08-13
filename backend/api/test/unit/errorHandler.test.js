import { describe, it, expect, vi } from 'vitest';
import { errorHandler } from '../../src/middleware/errorHandler.js';
import { AppError } from '../../src/utils/errors.js';

describe('errorHandler Middleware', () => {
  const mockReq = { requestId: 'req-123', ip: '127.0.0.1', method: 'GET', originalUrl: '/test' };

  it('handles entity.too.large error with 413', () => {
    const err = { type: 'entity.too.large' };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    errorHandler(err, mockReq, res, next);
    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Payload too large' });
  });

  it('handles SyntaxError with 400', () => {
    const err = new SyntaxError('Unexpected token');
    err.status = 400;
    err.body = '{ invalid }';
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    errorHandler(err, mockReq, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Malformed JSON payload' });
  });

  it('handles AppError with custom statusCode', () => {
    const err = new AppError('Unauthorized access', 401);
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    errorHandler(err, mockReq, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ success: false, error: 'Unauthorized access' });
  });

  it('sanitizes control characters from MulterError messages', () => {
    const err = { name: 'MulterError', code: 'LIMIT_UNEXPECTED_FILE', message: 'Unexpected field "file\x1b]0;evil\x07"' };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    errorHandler(err, mockReq, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    const body = res.json.mock.calls[0][0];
    expect(body.error).not.toMatch(/[\x00-\x1f\x7f]/);
    expect(body.code).toBe('LIMIT_UNEXPECTED_FILE');
  });

  it('provides a default code for MulterError without a code', () => {
    const err = { name: 'MulterError', message: 'File upload error' };
    const res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    const next = vi.fn();

    errorHandler(err, mockReq, res, next);
    const body = res.json.mock.calls[0][0];
    expect(body.code).toBe('UPLOAD_ERROR');
  });
});
