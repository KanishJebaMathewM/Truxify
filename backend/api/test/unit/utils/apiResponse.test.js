import { describe, it, expect, afterEach } from 'vitest';
import { errorResponse } from '../../../src/utils/apiResponse.js';

describe('utils/apiResponse errorResponse', () => {
  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('returns the standard error envelope with code and message', () => {
    const response = errorResponse('NOT_FOUND', 'Resource not found');
    expect(response).toEqual({
      success: false,
      error: {
        code: 'NOT_FOUND',
        message: 'Resource not found',
      },
    });
  });

  it('preserves a numeric code', () => {
    const response = errorResponse(404, 'Not found');
    expect(response.error.code).toBe(404);
  });

  it('omits details in production', () => {
    process.env.NODE_ENV = 'production';
    const response = errorResponse('BAD_REQUEST', 'Invalid payload', { field: 'lat' });
    expect(response.error).toEqual({
      code: 'BAD_REQUEST',
      message: 'Invalid payload',
    });
    expect('details' in response.error).toBe(false);
  });

  it('includes details when not in production', () => {
    delete process.env.NODE_ENV;
    const response = errorResponse('BAD_REQUEST', 'Invalid payload', { field: 'lat' });
    expect(response.error.details).toEqual({ field: 'lat' });
  });

  it('omits details when undefined even outside production', () => {
    delete process.env.NODE_ENV;
    const response = errorResponse('BAD_REQUEST', 'Invalid payload', undefined);
    expect('details' in response.error).toBe(false);
  });
});
