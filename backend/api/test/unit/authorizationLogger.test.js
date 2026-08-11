import { vi, describe, it, expect, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({ default: mockLogger }));

// The module computes isDev at import time; force development mode so the
// resourceType field is included.
vi.hoisted(() => {
  process.env.NODE_ENV = 'development';
});

import {
  logAuthGrant,
  logAuthDenial,
  logUnknownAction,
  logAuthFailure,
  createRequestAuthLogger,
} from '../../src/core/auth/authorizationLogger.js';

describe('authorizationLogger', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('logAuthGrant', () => {
    it('logs an info entry with user and action', () => {
      logAuthGrant({ user: { id: 'u1', role: 'driver' }, action: 'order:view', requestId: 'r1', durationMs: 5 });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({
        event: 'AUTH_GRANT',
        action: 'order:view',
        userId: 'u1',
        userRole: 'driver',
        requestId: 'r1',
        durationMs: 5,
      }));
    });

    it('adds resourceType for object resources in dev', () => {
      logAuthGrant({ user: { id: 'u1' }, action: 'a', resource: { id: 1 } });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ resourceType: 'object' }));
    });
  });

  describe('logAuthDenial', () => {
    it('logs a warn entry with reason', () => {
      logAuthDenial({ user: { id: 'u1', role: 'driver' }, action: 'order:view', reason: 'role', requestId: 'r1' });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'AUTH_DENIAL',
        action: 'order:view',
        reason: 'role',
        requestId: 'r1',
      }));
    });
  });

  describe('logUnknownAction', () => {
    it('logs a warn entry', () => {
      logUnknownAction({ user: { id: 'u1' }, action: 'no:such', requestId: 'r1' });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'AUTH_UNKNOWN_ACTION',
        action: 'no:such',
        requestId: 'r1',
      }));
    });
  });

  describe('logAuthFailure', () => {
    it('logs a warn entry', () => {
      logAuthFailure({ reason: 'invalid token', ip: '1.2.3.4', requestId: 'r1' });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({
        event: 'AUTH_FAILURE',
        reason: 'invalid token',
        ip: '1.2.3.4',
        requestId: 'r1',
      }));
    });
  });

  describe('createRequestAuthLogger', () => {
    it('scopes all methods to the request id', () => {
      const logger = createRequestAuthLogger('req-123');
      logger.grant({ user: { id: 'u1' }, action: 'a' });
      expect(mockLogger.info).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-123' }));
      logger.denial({ user: { id: 'u1' }, action: 'a', reason: 'x' });
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'req-123' }));
      logger.unknownAction({ user: { id: 'u1' }, action: 'a' });
      logger.failure({ reason: 'r' });
    });
  });
});
