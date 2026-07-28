import { describe, it, expect } from 'vitest';
import logger from '../src/middleware/logger.js';

describe('Logger Middleware', () => {
  it('logs info without errors', () => {
    expect(() => {
      logger.info({
        authorization: 'Bearer abc123',
        password: 'secret',
        apiKey: 'xyz',
      });
    }).not.toThrow();
  });
});
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, __testing } from '../../src/middleware/logger.js';
import pino from 'pino';

describe('logger', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('should export a pino logger instance', () => {
    expect(logger).toBeInstanceOf(pino.constructor);
  });

  it('should have info level configured', () => {
    expect(typeof logger.info).toBe('function');
  });

  it('should export testing internals', () => {
    expect(__testing).toBeDefined();
  });
});
