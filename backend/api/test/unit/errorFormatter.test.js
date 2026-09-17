import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { formatError } from '../../src/utils/errorFormatter.js';

describe('errorFormatter', () => {
  let env;

  beforeEach(() => {
    env = process.env.NODE_ENV;
  });

  afterEach(() => {
    process.env.NODE_ENV = env;
  });

  describe('formatError', () => {
    it('returns correct structure with code and message', () => {
      const result = formatError('ERR_CODE', 'Something went wrong');
      expect(result).toEqual({
        success: false,
        error: {
          code: 'ERR_CODE',
          message: 'Something went wrong',
        },
      });
    });

    it('returns correct structure without details in production', () => {
      process.env.NODE_ENV = 'production';
      const result = formatError('ERR_CODE', 'Error message', { extra: 'data' });
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
      const details = { field: 'email', issue: 'invalid' };
      const result = formatError('VALIDATION_ERROR', 'Validation failed', details);
      expect(result).toEqual({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details,
        },
      });
    });

    it('omits details when not provided', () => {
      process.env.NODE_ENV = 'development';
      const result = formatError('ERR', 'Error');
      expect(result.error).not.toHaveProperty('details');
    });

    it('handles undefined details', () => {
      const result = formatError('ERR', 'Error', undefined);
      expect(result.error).not.toHaveProperty('details');
    });
  });
});
