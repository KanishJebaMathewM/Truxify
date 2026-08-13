import { describe, it, expect } from 'vitest';
import { normalizeIp, safeIpKeyGenerator, userKeyGenerator } from '../../src/middleware/rateLimiter.js';

describe('rateLimiter - normalizeIp & IPv6 Subnet Masking', () => {
  it('returns unknown for invalid or missing IP', () => {
    expect(normalizeIp(null)).toBe('unknown');
    expect(normalizeIp(undefined)).toBe('unknown');
    expect(normalizeIp('')).toBe('unknown');
  });

  it('normalizes IPv4 addresses correctly', () => {
    expect(normalizeIp('192.168.1.100')).toBe('192.168.1.100');
    expect(normalizeIp('::ffff:192.168.1.100')).toBe('192.168.1.100');
    expect(normalizeIp('::1')).toBe('127.0.0.1');
  });

  it('groups IPv6 addresses into /64 subnets to prevent rate limit bypass', () => {
    const ip1 = '2001:0db8:85a3:0000:0000:8a2e:0370:7334';
    const ip2 = '2001:0db8:85a3:0000:ffff:ffff:ffff:ffff';

    const subnet1 = normalizeIp(ip1);
    const subnet2 = normalizeIp(ip2);

    expect(subnet1).toBe('2001:0db8:85a3:0000::/64');
    expect(subnet2).toBe('2001:0db8:85a3:0000::/64');
    expect(subnet1).toBe(subnet2);
  });

  it('safeIpKeyGenerator extracts and normalizes IP from req object', () => {
    const reqV4 = { ip: '1.2.3.4' };
    expect(safeIpKeyGenerator(reqV4)).toBe('1.2.3.4');

    const reqV6 = { ip: '2001:db8:1234:5678:90ab:cdef:1234:5678' };
    expect(safeIpKeyGenerator(reqV6)).toBe('2001:db8:1234:5678::/64');
  });

  it('userKeyGenerator uses user identity when present, falling back to IP', () => {
    const reqWithUser = { user: { id: 'usr_123' }, ip: '1.2.3.4' };
    expect(userKeyGenerator(reqWithUser)).toBe('user:usr_123');

    const reqAnon = { ip: '1.2.3.4' };
    expect(userKeyGenerator(reqAnon)).toBe('1.2.3.4');
  });

  it('distinct forwarded client IPs produce distinct rate-limit keys when trust proxy resolves req.ip', () => {
    // With app.set('trust proxy', 1) Express populates req.ip from the
    // X-Forwarded-For header, so two different clients behind the same
    // reverse proxy must be keyed separately rather than collapsed into a
    // single shared bucket.
    const reqClientA = {
      ip: '203.0.113.5',
      headers: { 'x-forwarded-for': '203.0.113.5' },
      socket: { remoteAddress: '10.0.0.1' },
    };
    const reqClientB = {
      ip: '203.0.113.9',
      headers: { 'x-forwarded-for': '203.0.113.9' },
      socket: { remoteAddress: '10.0.0.1' },
    };

    const keyA = safeIpKeyGenerator(reqClientA);
    const keyB = safeIpKeyGenerator(reqClientB);

    expect(keyA).toBe('203.0.113.5');
    expect(keyB).toBe('203.0.113.9');
    expect(keyA).not.toBe(keyB);
    // Both clients shared the same immediate peer, but must not share a bucket.
    expect(keyA).not.toBe(safeIpKeyGenerator({ ip: '10.0.0.1' }));
  });
});
