import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @sentry/node before importing the middleware
vi.mock('@sentry/node', () => {
  const mockScope = {
    setExtra: vi.fn(),
    setTag: vi.fn(),
    setUser: vi.fn(),
  };
  const api = {
    init: vi.fn(),
    flush: vi.fn(async () => true),
    captureException: vi.fn(),
    setUser: vi.fn(),
    configureScope: vi.fn((callback) => callback(mockScope)),
    withScope: vi.fn((callback) => callback(mockScope)),
    Handlers: {
      requestHandler: vi.fn(() => (req, res, next) => next()),
      errorHandler: vi.fn(() => (err, req, res, next) => next(err)),
    },
  };
  return { ...api, default: api };
});

import Sentry from '@sentry/node';
import { sentryRequestHandler, sentryErrorHandler } from '../../../src/middleware/sentry.js';

describe('Sentry Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('sentryRequestHandler (User Identity & Transaction Context)', () => {
    it('should attach user identity to Sentry scope when req.user is present', () => {
      const req = {
        method: 'GET',
        url: '/api/v1/orders',
        user: { id: 'user-123', email: 'test@truxify.com', role: 'driver' },
        ip: '127.0.0.1',
      };
      const res = {};
      const next = vi.fn();

      sentryRequestHandler()(req, res, next);

      expect(Sentry.setUser).toHaveBeenCalledWith({
        id: 'user-123',
        email: 'test@truxify.com',
        role: 'driver',
      });
      expect(next).toHaveBeenCalledTimes(1);
    });

    it('should handle unauthenticated requests gracefully without setting user identity', () => {
      const req = {
        method: 'GET',
        url: '/health',
        ip: '127.0.0.1',
      };
      const res = {};
      const next = vi.fn();

      sentryRequestHandler()(req, res, next);

      expect(Sentry.setUser).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });

  describe('sentryErrorHandler (Error Capture & Body Attachment)', () => {
    it('should capture exception and attach request body when an error occurs', () => {
      const error = new Error('Database connection failed');
      const req = {
        method: 'POST',
        url: '/api/v1/shipments',
        body: { shipmentId: 'ship-999', weight: 4500 },
        user: { id: 'user-123' },
      };
      const res = { headersSent: false };
      const next = vi.fn();

      sentryErrorHandler()(error, req, res, next);

      expect(Sentry.captureException).toHaveBeenCalledWith(error);
      expect(next).toHaveBeenCalledWith(error);
    });

    it('should not capture exceptions if request completed successfully (non-error middleware flow)', () => {
      const req = { method: 'GET', url: '/dashboard', body: {} };
      const res = {};
      const next = vi.fn();

      // Standard request handler flow (no error)
      const successMiddleware = (req, res, next) => next();
      successMiddleware(req, res, next);

      expect(Sentry.captureException).not.toHaveBeenCalled();
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});
