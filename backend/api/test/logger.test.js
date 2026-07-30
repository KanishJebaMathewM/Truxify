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