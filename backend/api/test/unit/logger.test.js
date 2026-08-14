import { describe, it, expect } from 'vitest';
import { LOG_LEVELS, sanitizeLogLevel } from '../../../src/middleware/logger.js';

describe('LOG_LEVELS', () => {
  it('contains all expected log levels', () => {
    expect(LOG_LEVELS).toEqual(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);
  });
});

describe('sanitizeLogLevel', () => {
  it('returns the level when it is a valid log level', () => {
    expect(sanitizeLogLevel('debug')).toBe('debug');
    expect(sanitizeLogLevel('error')).toBe('error');
    expect(sanitizeLogLevel('info')).toBe('info');
  });

  it('returns info for an invalid log level', () => {
    expect(sanitizeLogLevel('invalid')).toBe('info');
    expect(sanitizeLogLevel('')).toBe('info');
    expect(sanitizeLogLevel('TRACE')).toBe('info');
  });
});
