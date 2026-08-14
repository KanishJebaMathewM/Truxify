import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { errorResponse } from '../../src/utils/apiResponse.js';

describe('apiResponse errorResponse', () => {
  let env;

  beforeEach(() => {
    env = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  it('returns correct structure with code and message', () => {
    const result = errorResponse('ERR_CODE', 'Error message');
    expect(result).toEqual({
      success: false,
      error: {
        code: 'ERR_CODE',
        message: 'Error message',
      },
    });
  });

  it('includes details in non-production environments', () => {
    process.env.NODE_ENV = 'development';
    const result = errorResponse('ERR', 'Error', { extra: 'data' });
    expect(result.error.details).toEqual({ extra: 'data' });
  });

  it('omits details in production', () => {
    process.env.NODE_ENV = 'production';
    const result = errorResponse('ERR', 'Error', { extra: 'data' });
    expect(result.error).not.toHaveProperty('details');
  });

  it('omits details when not provided', () => {
    process.env.NODE_ENV = 'development';
    const result = errorResponse('ERR', 'Error');
    expect(result.error).not.toHaveProperty('details');
  });
});
