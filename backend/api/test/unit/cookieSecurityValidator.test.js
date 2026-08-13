/**
 * Unit tests for backend/api/src/middleware/cookieSecurityValidator.js
 *
 * Coverage:
 *   - validateCookies warns when HttpOnly is missing
 *   - validateCookies warns when SameSite is missing
 *   - validateCookies warns when Secure is missing
 *   - validateCookies warns when Path is missing
 *   - validateCookies does not warn when all recommended attributes are present
 *   - validateCookies handles array of cookie values
 *
 * Run with: npm run test:unit -- test/unit/cookieSecurityValidator.test.js
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockLogger = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

vi.mock('../../src/middleware/logger.js', () => ({
  default: mockLogger,
}));

const { default: cookieSecurityValidator } = await import('../../src/middleware/cookieSecurityValidator.js');

describe('cookieSecurityValidator', () => {
  let req;
  let res;
  let next;
  let originalSetHeader;

  beforeEach(() => {
    vi.clearAllMocks();
    req = { method: 'GET', originalUrl: '/test' };
    res = {
      setHeader: vi.fn(),
    };
    next = vi.fn();
    originalSetHeader = res.setHeader;
  });

  function applyValidator() {
    cookieSecurityValidator(req, res, next);
  }

  describe('validateCookies', () => {
    it('warns when HttpOnly attribute is missing', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; Path=/; SameSite=Strict');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ missingAttributes: expect.arrayContaining(['HttpOnly']) }),
        expect.stringContaining('missing recommended security attributes')
      );
    });

    it('warns when SameSite attribute is missing', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; Path=/; HttpOnly');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ missingAttributes: expect.arrayContaining(['SameSite']) }),
        expect.stringContaining('missing recommended security attributes')
      );
    });

    it('warns when Secure attribute is missing', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; Path=/; HttpOnly; SameSite=Strict');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ missingAttributes: expect.arrayContaining(['Secure']) }),
        expect.stringContaining('missing recommended security attributes')
      );
    });

    it('warns when Path attribute is missing', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; HttpOnly; SameSite=Strict');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.objectContaining({ missingAttributes: expect.arrayContaining(['Path']) }),
        expect.stringContaining('missing recommended security attributes')
      );
    });

    it('does not warn when all recommended attributes are present', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; HttpOnly; SameSite=Strict; Path=/; Secure');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('handles an array of cookie values', () => {
      applyValidator();
      res.setHeader('set-cookie', ['session=abc123; Path=/; SameSite=Strict', 'tracking=xyz; Path=/']);
      // First cookie missing HttpOnly and Secure, second missing HttpOnly, SameSite, Secure
      expect(mockLogger.warn).toHaveBeenCalledTimes(2);
    });

    it('does not warn when attributes use lowercase names', () => {
      applyValidator();
      res.setHeader('set-cookie', 'session=abc123; httponly; samesite=strict; path=/; secure');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });
  });

  describe('isSecureCookieConfig', () => {
    it('returns true when all attributes are present', async () => {
      const { isSecureCookieConfig } = await import('../../src/middleware/cookieSecurityValidator.js');
      expect(isSecureCookieConfig('session=123; HttpOnly; Secure; SameSite=Strict; Path=/')).toBe(true);
    });

    it('returns false when any recommended attribute is missing', async () => {
      const { isSecureCookieConfig } = await import('../../src/middleware/cookieSecurityValidator.js');
      expect(isSecureCookieConfig('session=123; Path=/')).toBe(false);
      expect(isSecureCookieConfig(null)).toBe(false);
    });
  });
});

