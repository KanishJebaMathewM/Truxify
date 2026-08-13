import { describe, it, expect } from 'vitest';
import { AuthorizationError } from '../../../../src/core/auth/AuthorizationError.js';

describe('AuthorizationError', () => {
  it('should create an error with a status and message', () => {
    const error = new AuthorizationError(403, 'Not authorized');
    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(AuthorizationError);
    expect(error.message).toBe('Not authorized');
    expect(error.status).toBe(403);
  });

  it('should have AuthorizationError as name', () => {
    const error = new AuthorizationError(403, 'Forbidden');
    expect(error.name).toBe('AuthorizationError');
  });

  it('should use the error code when provided', () => {
    const error = new AuthorizationError(403, 'Access denied', 'ROLE_NOT_ALLOWED');
    expect(error.errorCode).toBe('ROLE_NOT_ALLOWED');
  });

  it('should infer UNAUTHENTICATED for a 401 status', () => {
    const error = new AuthorizationError(401, 'Not authenticated');
    expect(error.errorCode).toBe('UNAUTHENTICATED');
  });

  it('should infer FORBIDDEN for a 403 status', () => {
    const error = new AuthorizationError(403, 'Forbidden');
    expect(error.errorCode).toBe('FORBIDDEN');
  });

  it('should default to AUTHORIZATION_ERROR for other statuses', () => {
    const error = new AuthorizationError(500, 'Unexpected');
    expect(error.errorCode).toBe('AUTHORIZATION_ERROR');
  });

  it('should serialize via toJSON', () => {
    const error = new AuthorizationError(403, 'Forbidden', 'FORBIDDEN');
    expect(error.toJSON()).toEqual({
      error: 'Forbidden',
      errorCode: 'FORBIDDEN',
      status: 403,
    });
  });

  it('should capture a stack trace', () => {
    const error = new AuthorizationError(403, 'Stack trace test');
    expect(error.stack).toBeDefined();
    expect(error.stack).toContain('AuthorizationError');
  });
});
