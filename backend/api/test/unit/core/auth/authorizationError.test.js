import { describe, it, expect } from 'vitest';
import { AuthorizationError } from '../../../../src/core/auth/AuthorizationError.js';

describe('AuthorizationError', () => {
  it('should create an error with a message', () => {
    const error = new AuthorizationError('Not authorized');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toBe('Not authorized');
  });

  it('should have AuthorizationError as name', () => {
    const error = new AuthorizationError('Forbidden');
    expect(error.name).toBe('AuthorizationError');
  });

  it('should have the code property set when provided', () => {
    const error = new AuthorizationError('Access denied', 'ERR_ACCESS_DENIED');
    expect(error.code).toBe('ERR_ACCESS_DENIED');
  });

  it('should default code to undefined when not provided', () => {
    const error = new AuthorizationError('No access');
    expect(error.code).toBeUndefined();
  });

  it('should capture a stack trace', () => {
    const error = new AuthorizationError('Stack trace test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AuthorizationError');
  });
});
