/**
 * Unit tests for backend/api/src/utils/apiResponse.js
 *
 * Coverage:
 *   - errorResponse: success=false, error.code, error.message, details in non-production
 *
 * Run with:  npm test -- test/unit/apiResponse.test.js
 */
import { describe, it, expect, vi } from 'vitest';
import { errorResponse } from '../../src/utils/apiResponse.js';

describe('apiResponse — errorResponse', () => {
  it('returns success false and correct error structure', () => {
    const result = errorResponse('VALIDATION_ERROR', 'Missing required field');
    expect(result).toEqual({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Missing required field',
      },
    });
  });

  it('omits details field when NODE_ENV is production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const result = errorResponse('SERVER_ERROR', 'Internal error', { foo: 'bar' });
    expect(result.error.details).toBeUndefined();
    process.env.NODE_ENV = originalEnv;
  });

  it('includes details field when NODE_ENV is development', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const result = errorResponse('SERVER_ERROR', 'Debug info', { debug: 'value' });
    expect(result.error.details).toEqual({ debug: 'value' });
    process.env.NODE_ENV = originalEnv;
  });

  it('includes details field when NODE_ENV is not production', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'test';
    const result = errorResponse('AUTH_ERROR', 'Token expired', { tokenId: 'abc' });
    expect(result.error.details).toEqual({ tokenId: 'abc' });
    process.env.NODE_ENV = originalEnv;
  });

  it('omits details when details is undefined', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const result = errorResponse('BAD_REQUEST', 'Bad input');
    expect(result.error.details).toBeUndefined();
    process.env.NODE_ENV = originalEnv;
  });
});
