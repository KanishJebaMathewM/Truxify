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
});
