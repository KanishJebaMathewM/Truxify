import { describe, it, expect, vi, beforeEach } from 'vitest';
import cookieSecurityValidator, {
  parseCookieSecurityHeader,
  auditCookieCompliance,
  sanitizeCookieHeader,
  validateCookiePrefixPolicy,
  generateSecureCookieHeader,
  detectCookieAnomaly,
  CookieSecurityManager
} from '../../src/middleware/cookieSecurityValidator.js';

describe('Cookie Security Validator & Enterprise Suite (Issue #14104)', () => {

  describe('cookieSecurityValidator Middleware Interception', () => {
    let req, res, next;

    beforeEach(() => {
      req = { method: 'POST', originalUrl: '/api/v1/checkout/session' };
      res = {
        setHeader: () => {}
      };
      next = vi.fn();
    });

    it('intercepts res.setHeader, wraps Set-Cookie, and invokes next()', () => {
      const spySetHeader = vi.spyOn(res, 'setHeader');
      
      cookieSecurityValidator(req, res, next);
      
      expect(next).toHaveBeenCalledTimes(1);
      expect(typeof res.setHeader).toBe('function');

      // Trigger cookie setting
      res.setHeader('Set-Cookie', 'auth_token=xyz789; HttpOnly');
      expect(spySetHeader).toHaveBeenCalledWith('Set-Cookie', 'auth_token=xyz789; HttpOnly');
    });

    it('handles arrays of set-cookie headers safely', () => {
      cookieSecurityValidator(req, res, next);
      
      const cookies = [
        'session_id=abc; HttpOnly; Secure; SameSite=Strict',
        'tracking_id=123'
      ];
      
      expect(() => {
        res.setHeader('Set-Cookie', cookies);
      }).not.toThrow();
    });

    it('ignores non-cookie headers without triggering validation warnings', () => {
      const spySetHeader = vi.spyOn(res, 'setHeader');
      cookieSecurityValidator(req, res, next);

      res.setHeader('Content-Type', 'application/json');
      res.setHeader('X-Custom-Header', 'secure-value');

      expect(spySetHeader).toHaveBeenCalledWith('Content-Type', 'application/json');
      expect(spySetHeader).toHaveBeenCalledWith('X-Custom-Header', 'secure-value');
    });

    it('handles case-insensitive header names correctly', () => {
      cookieSecurityValidator(req, res, next);
      expect(() => {
        res.setHeader('sEt-cOoKiE', 'test=val');
      }).not.toThrow();
    });
  });

  describe('parseCookieSecurityHeader (Enterprise Extension Parsing)', () => {
    it('correctly parses complex Set-Cookie header strings with multiple attributes', () => {
      const raw = '__Host-session=securetoken999; Domain=api.truxify.com; Path=/; Max-Age=3600; HttpOnly; Secure; SameSite=Strict';
      const parsed = parseCookieSecurityHeader(raw);
      
      expect(parsed.name).toBe('__Host-session');
      expect(parsed.value).toBe('securetoken999');
      expect(parsed.isHttpOnly).toBe(true);
      expect(parsed.isSecure).toBe(true);
      expect(parsed.sameSite).toBe('Strict');
      expect(parsed.attributes).toContain('HttpOnly');
      expect(parsed.attributes).toContain('Secure');
    });

    it('handles empty, null, undefined, or non-string inputs safely', () => {
      expect(parseCookieSecurityHeader('')).toEqual({
        name: null,
        value: null,
        attributes: [],
        isSecure: false,
        isHttpOnly: false,
        sameSite: null
      });
      expect(parseCookieSecurityHeader(null)).toHaveProperty('name', null);
      expect(parseCookieSecurityHeader(undefined)).toHaveProperty('name', null);
      expect(parseCookieSecurityHeader(12345)).toHaveProperty('name', null);
    });
  });

  describe('auditCookieCompliance (Compliance Auditor Extension)', () => {
    it('returns 100% compliance score when all cookies contain recommended attributes', () => {
      const secureBatch = [
        'session=abc; HttpOnly; Secure; SameSite=Strict',
        'auth=xyz; HttpOnly; Secure; SameSite=Lax'
      ];
      const report = auditCookieCompliance(secureBatch);
      
      expect(report.totalChecked).toBe(2);
      expect(report.compliantCount).toBe(2);
      expect(report.violationCount).toBe(0);
      expect(report.complianceScore).toBe(100);
      expect(report.violations).toHaveLength(0);
    });

    it('accurately isolates missing security attributes and computes partial compliance scores', () => {
      const mixedBatch = [
        'weakCookie=123', // Missing HttpOnly, Secure, SameSite
        'partialCookie=456; HttpOnly; Secure', // Missing SameSite
        'perfectCookie=789; HttpOnly; Secure; SameSite=Strict'
      ];
      
      const report = auditCookieCompliance(mixedBatch);
      
      expect(report.totalChecked).toBe(3);
      expect(report.compliantCount).toBe(1);
      expect(report.violationCount).toBe(2);
      expect(report.complianceScore).toBe(33); // 1/3 = 33%
      expect(report.violations[0].cookieName).toBe('weakCookie');
      expect(report.violations[0].missingAttributes).toEqual(['HttpOnly', 'Secure', 'SameSite']);
      expect(report.violations[1].cookieName).toBe('partialCookie');
      expect(report.violations[1].missingAttributes).toEqual(['SameSite']);
    });

    it('handles single string inputs and empty arrays gracefully', () => {
      const singleReport = auditCookieCompliance('sid=99; HttpOnly; Secure; SameSite=Strict');
      expect(singleReport.complianceScore).toBe(100);

      const emptyReport = auditCookieCompliance([]);
      expect(emptyReport.totalChecked).toBe(0);
      expect(emptyReport.complianceScore).toBe(100);
    });
  });

  describe('CookieSecurityManager Unified Export Object', () => {
    it('exposes middleware and all audit utilities correctly', () => {
      expect(typeof CookieSecurityManager.cookieSecurityValidator).toBe('function');
      expect(typeof CookieSecurityManager.parseCookieSecurityHeader).toBe('function');
      expect(typeof CookieSecurityManager.auditCookieCompliance).toBe('function');
    });
  });



  describe('Advanced Enterprise Cookie Security Edge Cases (Issue #14104 Expansion)', () => {
    
    it('correctly handles cookies with SameSite=Lax and SameSite=None flags', () => {
      const laxCookie = parseCookieSecurityHeader('session=123; SameSite=Lax; Secure');
      expect(laxCookie.sameSite).toBe('Lax');
      expect(laxCookie.isSecure).toBe(true);

      const noneCookie = parseCookieSecurityHeader('tracking=xyz; SameSite=None; Secure');
      expect(noneCookie.sameSite).toBe('None');
    });

    it('audits complex mixed cookie batches with extreme violation scenarios', () => {
      const massiveBatch = [
        'c1=1; HttpOnly; Secure; SameSite=Strict',
        'c2=2', // 3 violations
        'c3=3; HttpOnly', // missing Secure, SameSite
        'c4=4; Secure; SameSite=Lax' // missing HttpOnly
      ];

      const audit = auditCookieCompliance(massiveBatch);
      expect(audit.totalChecked).toBe(4);
      expect(audit.compliantCount).toBe(1);
      expect(audit.violationCount).toBe(3);
      expect(audit.violations).toHaveLength(3);
      expect(audit.complianceScore).toBe(25); // 1/4 = 25%
    });

    it('safely validates cookie values containing equal signs or semicolons', () => {
      const complexCookie = parseCookieSecurityHeader('data=token=abc&sig=123; Path=/; HttpOnly');
      expect(complexCookie.name).toBe('data');
      expect(complexCookie.value).toBe('token=abc&sig=123');
      expect(complexCookie.isHttpOnly).toBe(true);
    });

  });



  describe('sanitizeCookieHeader (Production Hardening Extension)', () => {
    it('automatically injects missing security attributes and hardens cookie strings', () => {
      const raw = 'session=secret123';
      const sanitized = sanitizeCookieHeader(raw);
      expect(sanitized).toContain('HttpOnly');
      expect(sanitized).toContain('Secure');
      expect(sanitized).toContain('SameSite=Strict');
    });

    it('returns empty string for invalid inputs', () => {
      expect(sanitizeCookieHeader('')).toBe('');
      expect(sanitizeCookieHeader(null)).toBe('');
    });
  });



  describe('validateCookiePrefixPolicy (RFC Prefix Security Policy Extension)', () => {
    it('validates and enforces strict requirements for __Host- prefixed cookies', () => {
      const validHostCookie = '__Host-id=999; Secure; Path=/; HttpOnly';
      const result = validateCookiePrefixPolicy(validHostCookie);
      expect(result.isValid).toBe(true);
      expect(result.violations).toHaveLength(0);

      const invalidHostCookie = '__Host-id=999; Domain=truxify.com'; // missing Secure and Path=/, has Domain
      const badResult = validateCookiePrefixPolicy(invalidHostCookie);
      expect(badResult.isValid).toBe(false);
      expect(badResult.violations.length).toBeGreaterThan(0);
    });

    it('enforces Secure attribute for __Secure- prefixed cookies', () => {
      const securePrefixed = '__Secure-token=abc; Secure; HttpOnly';
      expect(validateCookiePrefixPolicy(securePrefixed).isValid).toBe(true);

      const insecurePrefixed = '__Secure-token=abc'; // missing Secure
      expect(validateCookiePrefixPolicy(insecurePrefixed).isValid).toBe(false);
    });
  });



  describe('generateSecureCookieHeader & detectCookieAnomaly (Builder & Anomaly Detection Extensions)', () => {
    it('constructs hardened RFC-compliant cookie strings with secure defaults', () => {
      const cookieHeader = generateSecureCookieHeader('access_token', 'jwt_val_999', { maxAge: 7200 });
      expect(cookieHeader).toContain('access_token=jwt_val_999');
      expect(cookieHeader).toContain('HttpOnly');
      expect(cookieHeader).toContain('Secure');
      expect(cookieHeader).toContain('SameSite=Strict');
      expect(cookieHeader).toContain('Path=/');
      expect(cookieHeader).toContain('Max-Age=7200');
    });

    it('returns empty string for invalid builder parameters', () => {
      expect(generateSecureCookieHeader('', 'val')).toBe('');
      expect(generateSecureCookieHeader('name', null)).toBe('');
    });

    it('detects critical SameSite=None without Secure anomalies', () => {
      const vulnerableCookie = 'session=123; SameSite=None';
      const report = detectCookieAnomaly(vulnerableCookie);
      expect(report.riskLevel).toBe('CRITICAL');
      expect(report.anomaliesDetected).toBeGreaterThan(0);
      expect(report.warnings.some(w => w.includes('SameSite=None'))).toBe(true);
    });

    it('reports safe or low risk levels for fully compliant secure cookies', () => {
      const secureCookie = 'session=123; HttpOnly; Secure; SameSite=Strict; Path=/';
      const report = detectCookieAnomaly(secureCookie);
      expect(report.riskLevel).toBe('LOW');
      expect(report.anomaliesDetected).toBe(0);
    });

    it('handles empty or malformed cookie inputs safely in anomaly detector', () => {
      const emptyReport = detectCookieAnomaly('');
      expect(emptyReport.riskLevel).toBe('NONE');
      expect(emptyReport.anomaliesDetected).toBe(0);
    });
  });

});