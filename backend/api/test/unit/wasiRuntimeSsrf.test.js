import { describe, expect, it } from 'vitest';
import { is_url_allowed } from '../../src/services/wasi-runtime.js';

// SSRF guard for the WASI sandbox — domain-confusion and loopback bypasses
// here are server-side request forgery vulnerabilities.
describe('wasi-runtime is_url_allowed (SSRF guard)', () => {
  it('allows the exact allowed domain and proper subdomains', () => {
    expect(is_url_allowed('https://truxify.com/loads')).toBe(true);
    expect(is_url_allowed('https://api.truxify.com/v1')).toBe(true);
    expect(is_url_allowed('http://tracking.api.truxify.com/x')).toBe(true);
  });

  it('rejects domain-confusion suffixes', () => {
    expect(is_url_allowed('https://truxify.com.evil.com')).toBe(false);
    expect(is_url_allowed('https://eviltruxify.com')).toBe(false);
    expect(is_url_allowed('https://truxify.com@evil.com/')).toBe(false);
  });

  it('rejects non-http(s) protocols', () => {
    expect(is_url_allowed('file:///etc/passwd')).toBe(false);
    expect(is_url_allowed('ftp://truxify.com')).toBe(false);
    expect(is_url_allowed('gopher://truxify.com')).toBe(false);
    expect(is_url_allowed('javascript:alert(1)')).toBe(false);
  });

  it('rejects loopback + raw IPs + private ranges', () => {
    for (const u of [
      'http://localhost/', 'http://127.0.0.1/', 'http://[::1]/', 'http://0.0.0.0/',
      'http://10.0.0.5/', 'http://192.168.1.1/', 'http://172.16.0.1/', 'http://169.254.169.254/latest',
      'http://8.8.8.8/', // raw public IP: also blocked (allowlist is hostname-based)
    ]) {
      expect(is_url_allowed(u), u).toBe(false);
    }
  });

  it('rejects malformed/empty/non-string input without throwing', () => {
    expect(is_url_allowed('')).toBe(false);
    expect(is_url_allowed('not a url')).toBe(false);
    expect(is_url_allowed(null)).toBe(false);
    expect(is_url_allowed(undefined)).toBe(false);
    expect(is_url_allowed(42)).toBe(false);
  });

  it('case-insensitive hostname matching', () => {
    expect(is_url_allowed('https://TRUXIFY.COM/x')).toBe(true);
    expect(is_url_allowed('https://API.Truxify.Com/x')).toBe(true);
  });
});
