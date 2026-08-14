import { describe, it, expect } from 'vitest';
import { formatError } from '../../../src/utils/errorFormatter.js';

describe('formatError', () => {
  it('returns structured error object', () => {
    const result = formatError('ERR_NOT_FOUND', 'Resource not found');
    expect(result.success).toBe(false);
    expect(result.error.code).toBe('ERR_NOT_FOUND');
    expect(result.error.message).toBe('Resource not found');
  });

  it('omits details in production', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const result = formatError('ERR', 'msg', { extra: 'data' });
    expect(result.error.details).toBeUndefined();
    process.env.NODE_ENV = env;
  });

  it('includes details in non-production', () => {
    const env = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    const result = formatError('ERR', 'msg', { extra: 'data' });
    expect(result.error.details).toEqual({ extra: 'data' });
    process.env.NODE_ENV = env;
  });

  it('works without details', () => {
    const result = formatError('ERR', 'msg');
    expect(result.success).toBe(false);
    expect(result.error.details).toBeUndefined();
  });
});
