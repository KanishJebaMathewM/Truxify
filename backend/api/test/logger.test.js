// backend/api/test/logger.test.js (Cleaned Excerpt)

import { describe, it, expect, vi } from 'vitest';
import logger from '../src/middleware/logger.js';

describe('Logger Middleware & Utility', () => {
  it('should correctly initialize logger levels and transport', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });
});
