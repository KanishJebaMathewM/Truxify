import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

import cookieSecurityValidator from '../../src/middleware/cookieSecurityValidator.js';

describe('cookieSecurityValidator middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { method: 'GET', originalUrl: '/test' };
    res = {
      setHeader: vi.fn(),
    };
    next = vi.fn();
  });

  it('calls next() immediately', () => {
    cookieSecurityValidator(req, res, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it('sets a wrapped setHeader that calls the original', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Content-Type', 'application/json');
    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
  });

  it('does not warn for cookies with all recommended attributes', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc123; HttpOnly; SameSite=Strict; Path=/');
    expect(mockLogger.warn).not.toHaveBeenCalled();
  });

  it('warns when HttpOnly is missing', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc123; SameSite=Strict; Path=/');
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const logCall = mockLogger.warn.mock.calls[0][0];
    expect(logCall.missingAttributes).toContain('HttpOnly');
  });

  it('warns when SameSite is missing', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc123; HttpOnly; Path=/');
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const logCall = mockLogger.warn.mock.calls[0][0];
    expect(logCall.missingAttributes).toContain('SameSite');
  });

  it('warns when Path is missing', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc123; HttpOnly; SameSite=Strict');
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const logCall = mockLogger.warn.mock.calls[0][0];
    expect(logCall.missingAttributes).toContain('Path');
  });

  it('warns for multiple missing attributes', () => {
    cookieSecurityValidator(req, res, next);
    res.setHeader('Set-Cookie', 'session=abc123');
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const logCall = mockLogger.warn.mock.calls[0][0];
    expect(logCall.missingAttributes).toContain('HttpOnly');
    expect(logCall.missingAttributes).toContain('SameSite');
    expect(logCall.missingAttributes).toContain('Path');
  });

  it('handles an array of Set-Cookie values', () => {
    cookieSecurityValidator(req, res, next);
    const cookies = ['session=abc; HttpOnly; SameSite=Strict; Path=/', 'tracking=xyz'];
    res.setHeader('Set-Cookie', cookies);
    expect(mockLogger.warn).toHaveBeenCalledOnce();
    const logCall = mockLogger.warn.mock.calls[0][0];
    expect(logCall.missingAttributes).toContain('Path');
  });
});
